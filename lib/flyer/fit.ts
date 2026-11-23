import { createCanvas, CanvasInstance } from "./canvas";
import { applyPhotoStyle, PhotoStylePreset } from "./photo-style";

export interface FitRects {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

export interface FitOptions {
  fit?: "cover" | "contain";
  framingMode?: "center" | "top-center" | "face-aware" | "focal";
  focalPoint?: { x: number; y: number }; // normalized 0..1
  photoStyle?: PhotoStylePreset;
  bottomFade?: number;
  contrast?: number;
  brightness?: number;
  warmth?: number;
}

/**
 * Calculates source and destination crop rectangles for cover/contain with focal point positioning.
 */
export function calculateFit(
  containerWidth: number,
  containerHeight: number,
  imageWidth: number,
  imageHeight: number,
  options: FitOptions = {}
): FitRects {
  const cw = Math.max(1, containerWidth);
  const ch = Math.max(1, containerHeight);
  const iw = Math.max(1, imageWidth);
  const ih = Math.max(1, imageHeight);

  const fit = options.fit ?? "cover";
  const framing = options.framingMode ?? "center";

  // Determine normalized focal point
  let fx = 0.5;
  let fy = 0.5;

  if (framing === "top-center") {
    fy = 0.25;
  } else if ((framing === "focal" || framing === "face-aware") && options.focalPoint) {
    fx = Math.max(0, Math.min(1, options.focalPoint.x));
    fy = Math.max(0, Math.min(1, options.focalPoint.y));
  }

  if (fit === "contain") {
    const scale = Math.min(cw / iw, ch / ih);
    const dw = Math.round(iw * scale);
    const dh = Math.round(ih * scale);
    const dx = Math.round((cw - dw) / 2);
    const dy = Math.round((ch - dh) / 2);

    return {
      sx: 0,
      sy: 0,
      sw: iw,
      sh: ih,
      dx,
      dy,
      dw,
      dh,
    };
  }

  // Cover mode
  const targetAspect = cw / ch;
  const imageAspect = iw / ih;

  let sw = iw;
  let sh = ih;
  let sx = 0;
  let sy = 0;

  if (imageAspect > targetAspect) {
    // Image is wider than target box: crop horizontally
    sw = Math.round(ih * targetAspect);
    sh = ih;
    sy = 0;
    const idealSx = fx * iw - sw / 2;
    sx = Math.round(Math.max(0, Math.min(iw - sw, idealSx)));
  } else {
    // Image is taller than target box: crop vertically
    sw = iw;
    sh = Math.round(iw / targetAspect);
    sx = 0;
    const idealSy = fy * ih - sh / 2;
    sy = Math.round(Math.max(0, Math.min(ih - sh, idealSy)));
  }

  return {
    sx,
    sy,
    sw,
    sh,
    dx: 0,
    dy: 0,
    dw: cw,
    dh: ch,
  };
}

/**
 * Draws an image into a container canvas applying fit cropping and an optional alpha mask.
 */
export function applyImageFitAndMask(
  image: CanvasInstance,
  targetWidth: number,
  targetHeight: number,
  options: FitOptions = {},
  maskCanvas?: CanvasInstance | null
): CanvasInstance {
  const tw = Math.max(1, Math.round(targetWidth));
  const th = Math.max(1, Math.round(targetHeight));

  const canvas = createCanvas(tw, th);
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const rects = calculateFit(tw, th, image.width, image.height, options);

  ctx.drawImage(
    image,
    rects.sx,
    rects.sy,
    rects.sw,
    rects.sh,
    rects.dx,
    rects.dy,
    rects.dw,
    rects.dh
  );

  if (maskCanvas) {
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(maskCanvas, 0, 0, tw, th);
    ctx.globalCompositeOperation = "source-over";
  }

  // Apply style color grading and bottom fade if requested
  if (
    (options.photoStyle && options.photoStyle !== "none") ||
    (options.bottomFade !== undefined && options.bottomFade > 0) ||
    options.contrast !== undefined ||
    options.brightness !== undefined ||
    options.warmth !== undefined
  ) {
    applyPhotoStyle(canvas, {
      style: options.photoStyle,
      bottomFade: options.bottomFade,
      contrast: options.contrast,
      brightness: options.brightness,
      warmth: options.warmth,
    });
  }

  return canvas;
}
