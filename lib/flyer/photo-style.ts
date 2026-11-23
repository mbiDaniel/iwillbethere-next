import { createCanvas, canvasToBlob, canvasToDataUrl, loadImageBitmap, CanvasInstance } from "./canvas";

export type PhotoStylePreset = "none" | "flyer-match" | "warm-cinema" | "studio" | "dramatic-bw";

export interface BackgroundRemovalOptions {
  tolerance?: number; // color difference threshold (default 42, range 15..90)
  feather?: number; // edge feathering in pixels (default 8, range 0..25)
  protectCenter?: boolean; // protect center subject from being erased (default true)
  samplePoints?: Array<{ x: number; y: number }>; // optional custom sample points
}

export interface PhotoStyleOptions {
  style?: PhotoStylePreset;
  contrast?: number; // 50..150, default 100
  brightness?: number; // 50..150, default 100
  warmth?: number; // -50..+50, default 0
  bottomFade?: number; // 0..50 (percentage of height to fade at bottom), default 0
  flyerThemeColor?: { r: number; g: number; b: number }; // default warm dark red: { r: 180, g: 30, b: 30 }
}

/**
 * Intelligent client-side background removal using multi-point boundary sampling,
 * flood-fill segmentation, and edge-preserving alpha matting.
 * Works 100% offline with zero dependencies in Browser, Web Worker, and Node.js.
 */
export async function removeBackgroundMatte(
  source: CanvasInstance | HTMLImageElement | string,
  options: BackgroundRemovalOptions = {}
): Promise<string> {
  let img: any;
  if (typeof source === "string") {
    img = await loadImageBitmap(source);
  } else {
    img = source;
  }

  const w = img.width || (img as any).naturalWidth || 400;
  const h = img.height || (img as any).naturalHeight || 400;

  // Process on a canvas
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get 2d context for background removal");

  ctx.drawImage(img, 0, 0, w, h);
  const imgData = ctx.getImageData(0, 0, w, h);
  const data = imgData.data;

  const tolerance = options.tolerance ?? 42;
  const feather = options.feather ?? 8;
  const protectCenter = options.protectCenter ?? true;

  // 1. Sample boundary/corner points to identify background color clusters
  const sampleCoords: Array<[number, number]> = options.samplePoints
    ? options.samplePoints.map((p) => [Math.round(p.x * w), Math.round(p.y * h)])
    : [
        // 4 corners
        [0, 0],
        [w - 1, 0],
        [0, h - 1],
        [w - 1, h - 1],
        // Top edge strip samples
        [Math.round(w * 0.25), 2],
        [Math.round(w * 0.5), 2],
        [Math.round(w * 0.75), 2],
        // Left & right edge strip samples
        [2, Math.round(h * 0.25)],
        [2, Math.round(h * 0.5)],
        [w - 3, Math.round(h * 0.25)],
        [w - 3, Math.round(h * 0.5)],
      ];

  const bgClusters: Array<{ r: number; g: number; b: number }> = [];
  for (const [sx, sy] of sampleCoords) {
    const clampedX = Math.max(0, Math.min(w - 1, sx));
    const clampedY = Math.max(0, Math.min(h - 1, sy));
    const idx = (clampedY * w + clampedX) * 4;
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];

    // Check if close to an existing cluster
    const match = bgClusters.find(
      (c) => Math.sqrt((c.r - r) ** 2 + (c.g - g) ** 2 + (c.b - b) ** 2) < 25
    );
    if (!match) {
      bgClusters.push({ r, g, b });
    }
  }

  // Fallback if no clusters found
  if (bgClusters.length === 0) {
    bgClusters.push({ r: data[0], g: data[1], b: data[2] });
  }

  // 2. Flood-fill mask from boundaries:
  // We identify which pixels are connected to the image boundaries with background colors.
  // This prevents erasing the subject's clothing or eyes even if they share colors with the background.
  const isBg = new Uint8Array(w * h); // 0 = unknown, 1 = background, 2 = foreground
  const queue: number[] = [];

  // Seed boundary pixels that match any background cluster
  function colorDist(r: number, g: number, b: number): number {
    let minDist = 999999;
    for (const c of bgClusters) {
      // Perceptual Euclidean distance
      const d = Math.sqrt(
        (c.r - r) * (c.r - r) * 0.299 +
        (c.g - g) * (c.g - g) * 0.587 +
        (c.b - b) * (c.b - b) * 0.114
      );
      if (d < minDist) minDist = d;
    }
    return minDist;
  }

  // Seed outer edges
  for (let x = 0; x < w; x++) {
    // top edge
    const topIdx = (0 * w + x) * 4;
    if (colorDist(data[topIdx], data[topIdx + 1], data[topIdx + 2]) < tolerance) {
      isBg[0 * w + x] = 1;
      queue.push(x, 0);
    }
    // bottom edge corners (skip bottom center where person's body usually sits)
    if (x < w * 0.2 || x > w * 0.8) {
      const btmIdx = ((h - 1) * w + x) * 4;
      if (colorDist(data[btmIdx], data[btmIdx + 1], data[btmIdx + 2]) < tolerance) {
        isBg[(h - 1) * w + x] = 1;
        queue.push(x, h - 1);
      }
    }
  }

  for (let y = 0; y < h; y++) {
    // left edge
    const lIdx = (y * w + 0) * 4;
    if (colorDist(data[lIdx], data[lIdx + 1], data[lIdx + 2]) < tolerance) {
      if (!isBg[y * w + 0]) {
        isBg[y * w + 0] = 1;
        queue.push(0, y);
      }
    }
    // right edge
    const rIdx = (y * w + (w - 1)) * 4;
    if (colorDist(data[rIdx], data[rIdx + 1], data[rIdx + 2]) < tolerance) {
      if (!isBg[y * w + (w - 1)]) {
        isBg[y * w + (w - 1)] = 1;
        queue.push(w - 1, y);
      }
    }
  }

  // Center protection zone bounds: center 50% width and 40% height where the face/head lives
  const centerXMin = protectCenter ? w * 0.25 : -1;
  const centerXMax = protectCenter ? w * 0.75 : -1;
  const centerYMin = protectCenter ? h * 0.2 : -1;
  const centerYMax = protectCenter ? h * 0.65 : -1;

  // BFS flood fill
  let head = 0;
  while (head < queue.length) {
    const qx = queue[head++];
    const qy = queue[head++];

    const neighbors = [
      [qx - 1, qy],
      [qx + 1, qy],
      [qx, qy - 1],
      [qx, qy + 1],
    ];

    for (const [nx, ny] of neighbors) {
      if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
        const nPos = ny * w + nx;
        if (isBg[nPos] === 0) {
          // If in center protection zone and color differs from seed cluster, stop
          if (
            protectCenter &&
            nx > centerXMin &&
            nx < centerXMax &&
            ny > centerYMin &&
            ny < centerYMax
          ) {
            continue;
          }

          const nIdx = nPos * 4;
          const dist = colorDist(data[nIdx], data[nIdx + 1], data[nIdx + 2]);
          if (dist < tolerance) {
            isBg[nPos] = 1;
            queue.push(nx, ny);
          }
        }
      }
    }
  }

  // 3. Apply alpha matting with smooth edge feathering
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const pos = y * w + x;
      const idx = pos * 4;

      if (isBg[pos] === 1) {
        // Connected to background: make transparent
        const dist = colorDist(data[idx], data[idx + 1], data[idx + 2]);
        if (feather > 0 && dist > tolerance - feather) {
          // Smooth alpha transition at boundary
          const alphaFactor = Math.max(0, Math.min(1, (tolerance - dist) / feather));
          data[idx + 3] = Math.round(data[idx + 3] * (1 - alphaFactor));
        } else {
          data[idx + 3] = 0;
        }
      }
    }
  }

  ctx.putImageData(imgData, 0, 0);
  return await canvasToDataUrl(canvas, "image/png");
}

/**
 * Attempts AI background removal if @imgly/background-removal is available in the environment,
 * otherwise transparently falls back to our smart matte algorithm.
 */
export async function removeBackground(
  source: CanvasInstance | HTMLImageElement | string,
  options: BackgroundRemovalOptions = {}
): Promise<string> {
  // Check if browser environment with potential @imgly/background-removal support
  if (typeof window !== "undefined") {
    try {
      const anyWin = window as any;
      if (anyWin.__imglyBackgroundRemoval) {
        const blob = await anyWin.__imglyBackgroundRemoval(source);
        const reader = new FileReader();
        return await new Promise((resolve) => {
          reader.onload = () => resolve(String(reader.result));
          reader.readAsDataURL(blob);
        });
      }
    } catch {
      // Fallback to smart canvas matte
    }
  }

  return await removeBackgroundMatte(source, options);
}

/**
 * Applies color grading and style adaptation to a photo canvas.
 * - "flyer-match" / "warm-cinema": Matches the dark red, amber, and rich contrast of the flyer in dd8ae8f5.jpg.
 * - "studio": Clean contrast and clarity.
 * - "dramatic-bw": High-contrast monochrome.
 * - bottomFade: Soft linear alpha fade on the bottom edge so the cutout blends into the background.
 */
export function applyPhotoStyle(
  canvas: CanvasInstance,
  options: PhotoStyleOptions = {}
): CanvasInstance {
  const {
    style = "none",
    contrast = 100,
    brightness = 100,
    warmth = 0,
    bottomFade = 0,
  } = options;

  const w = canvas.width;
  const h = canvas.height;
  if (!w || !h) return canvas;

  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  // 1. Color Grading & Tone Curves
  if (style !== "none" || contrast !== 100 || brightness !== 100 || warmth !== 0) {
    const imgData = ctx.getImageData(0, 0, w, h);
    const d = imgData.data;

    // Preset base adjustments
    let cFactor = contrast / 100;
    let bFactor = (brightness - 100) * 1.2;
    let rShift = warmth * 0.6;
    let bShift = -warmth * 0.6;
    let isBw = false;

    if (style === "flyer-match" || style === "warm-cinema") {
      // Rich contrast, deep warm red/amber shadows and glowing skin highlights
      cFactor *= 1.18;
      bFactor += 4;
      rShift += 14;
      bShift -= 10;
    } else if (style === "studio") {
      cFactor *= 1.1;
      bFactor += 3;
    } else if (style === "dramatic-bw") {
      cFactor *= 1.35;
      isBw = true;
    }

    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue; // skip transparent pixels

      let r = d[i];
      let g = d[i + 1];
      let b = d[i + 2];

      if (isBw) {
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        r = lum;
        g = lum;
        b = lum;
      }

      // Apply contrast: (val - 128) * factor + 128
      r = (r - 128) * cFactor + 128 + bFactor + rShift;
      g = (g - 128) * cFactor + 128 + bFactor;
      b = (b - 128) * cFactor + 128 + bFactor + bShift;

      // Extra warm shadow tint for flyer-match (mimics ambient reflection from red background)
      if (style === "flyer-match" || style === "warm-cinema") {
        if (r < 120) r += 8;
        if (g < 80) g += 3;
      }

      d[i] = Math.max(0, Math.min(255, Math.round(r)));
      d[i + 1] = Math.max(0, Math.min(255, Math.round(g)));
      d[i + 2] = Math.max(0, Math.min(255, Math.round(b)));
    }

    ctx.putImageData(imgData, 0, 0);
  }

  // 2. Soft Bottom Edge Feather / Fade
  // Allows the person's torso to blend seamlessly into the flyer background
  const fadePct = Math.max(0, Math.min(60, bottomFade));
  if (fadePct > 0) {
    const fadeHeight = Math.round(h * (fadePct / 100));
    const fadeStart = h - fadeHeight;

    const grad = ctx.createLinearGradient(0, fadeStart, 0, h);
    grad.addColorStop(0, "rgba(0, 0, 0, 1)");
    grad.addColorStop(0.5, "rgba(0, 0, 0, 0.7)");
    grad.addColorStop(0.85, "rgba(0, 0, 0, 0.2)");
    grad.addColorStop(1, "rgba(0, 0, 0, 0)");

    ctx.globalCompositeOperation = "destination-in";
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = "source-over";
  }

  return canvas;
}
