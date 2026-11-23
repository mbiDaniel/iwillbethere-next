/**
 * Pure TypeScript Canvas factory abstraction.
 * Works in Browser (OffscreenCanvas / HTMLCanvasElement), Web Worker, and Node.js (@napi-rs/canvas).
 * No React and no Next.js imports.
 */

declare const __non_webpack_require__: any;

function getNodeNapiCanvas(): any {
  if (typeof process === "undefined" || !process.versions?.node) {
    return null;
  }
  try {
    const req =
      typeof __non_webpack_require__ !== "undefined"
        ? __non_webpack_require__
        : typeof module !== "undefined" && typeof module.require === "function"
        ? module.require
        : typeof require === "function"
        ? require
        : null;
    return req ? req("@napi-rs/canvas") : null;
  } catch {
    return null;
  }
}

export interface CanvasDimensions {
  width: number;
  height: number;
}

export type Canvas2DContext = any;
export type CanvasInstance = any;

let customCanvasFactory: ((width: number, height: number) => CanvasInstance) | null = null;

export function setCanvasFactory(factory: (width: number, height: number) => CanvasInstance): void {
  customCanvasFactory = factory;
}

/**
 * Creates a canvas of specified width and height using the best available implementation.
 */
export function createCanvas(width: number, height: number): CanvasInstance {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));

  if (customCanvasFactory) {
    return customCanvasFactory(w, h);
  }

  // Web Worker or modern browser with OffscreenCanvas
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(w, h);
  }

  // Browser DOM environment
  if (typeof document !== "undefined" && typeof document.createElement === "function") {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    return canvas;
  }

  // Node.js environment with @napi-rs/canvas
  const napi = getNodeNapiCanvas();
  if (napi) {
    return napi.createCanvas(w, h);
  }

  throw new Error("No supported canvas implementation found in current environment");
}

/**
 * Converts a canvas instance into a standard Blob.
 */
export async function canvasToBlob(
  canvas: CanvasInstance,
  type: "image/png" | "image/jpeg" | "image/webp" = "image/png",
  quality?: number
): Promise<Blob> {
  // OffscreenCanvas
  if (typeof canvas.convertToBlob === "function") {
    return await canvas.convertToBlob({ type, quality });
  }

  // HTMLCanvasElement
  if (typeof canvas.toBlob === "function") {
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob: Blob | null) => {
          if (blob) resolve(blob);
          else reject(new Error("canvas.toBlob returned null"));
        },
        type,
        quality
      );
    });
  }

  // Node @napi-rs/canvas
  if (typeof canvas.encode === "function") {
    const format = type === "image/jpeg" ? "jpeg" : type === "image/webp" ? "webp" : "png";
    const q = quality !== undefined ? Math.round(quality * 100) : undefined;
    const buffer = await canvas.encode(format, q);
    return new Blob([buffer], { type });
  }

  // Fallback for canvas with toBuffer
  if (typeof canvas.toBuffer === "function") {
    const buffer = canvas.toBuffer(type);
    return new Blob([buffer], { type });
  }

  throw new Error("Canvas does not support blob conversion");
}

/**
 * Convenience helper to convert canvas to Buffer in Node.js or Uint8Array in browser.
 */
export async function canvasToBuffer(
  canvas: CanvasInstance,
  type: "image/png" | "image/jpeg" | "image/webp" = "image/png",
  quality?: number
): Promise<Uint8Array> {
  if (typeof canvas.encode === "function") {
    const format = type === "image/jpeg" ? "jpeg" : type === "image/webp" ? "webp" : "png";
    const q = quality !== undefined ? Math.round(quality * 100) : undefined;
    const buf = await canvas.encode(format, q);
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  const blob = await canvasToBlob(canvas, type, quality);
  const ab = await blob.arrayBuffer();
  return new Uint8Array(ab);
}

/**
 * Converts a Uint8Array into a base64 string in any environment
 * without external dependencies or stack overflow issues.
 */
export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  return btoa(binary);
}

/**
 * Converts a canvas instance directly into a data URL.
 * Works seamlessly in Browser (HTMLCanvasElement & OffscreenCanvas), Web Worker, and Node.js.
 */
export async function canvasToDataUrl(
  canvas: CanvasInstance,
  type: "image/png" | "image/jpeg" | "image/webp" = "image/png",
  quality?: number
): Promise<string> {
  if (typeof canvas.toDataURL === "function") {
    return canvas.toDataURL(type, quality);
  }
  const buf = await canvasToBuffer(canvas, type, quality);
  return `data:${type};base64,${uint8ArrayToBase64(buf)}`;
}

/**
 * Loads an image from Blob, Buffer, ArrayBuffer, or data/HTTP URL string into a drawable Image or ImageBitmap.
 */
export async function loadImageBitmap(
  source: Blob | Uint8Array | ArrayBuffer | string
): Promise<any> {
  if (typeof source === "string") {
    if (typeof Image !== "undefined") {
      return new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("Failed to load image from source URL"));
        img.src = source;
      });
    }
    const napi = getNodeNapiCanvas();
    if (napi) {
      if (source.startsWith("data:")) {
        const base64Data = source.split(",")[1];
        const buf = Buffer.from(base64Data, "base64");
        return await napi.loadImage(buf);
      }
      return await napi.loadImage(source);
    }
    if (typeof fetch !== "undefined" && typeof createImageBitmap === "function") {
      const res = await fetch(source);
      const blob = await res.blob();
      return await createImageBitmap(blob);
    }
  }

  if (typeof createImageBitmap === "function" && source instanceof Blob) {
    return await createImageBitmap(source);
  }
  if (typeof createImageBitmap === "function") {
    const blob = new Blob([source as any]);
    return await createImageBitmap(blob);
  }
  const napi = getNodeNapiCanvas();
  if (napi) {
    const buf =
      source instanceof Blob
        ? Buffer.from(await source.arrayBuffer())
        : Buffer.from(source as any);
    return await napi.loadImage(buf);
  }
  throw new Error("Cannot decode image in current environment");
}

