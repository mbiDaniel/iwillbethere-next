import { createCanvas } from "@napi-rs/canvas";
import { initializeCanvas } from "ag-psd";

let initialized = false;

export function ensureCanvasInitialized() {
  if (!initialized) {
    initializeCanvas(createCanvas as any);
    initialized = true;
  }
}
