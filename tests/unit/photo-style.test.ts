import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { createCanvas } from "@/lib/flyer/canvas";
import {
  removeBackgroundMatte,
  applyPhotoStyle,
} from "@/lib/flyer/photo-style";

describe("lib/flyer/photo-style", () => {
  it("removes background from solid/gradient backdrops", async () => {
    // Create a 100x100 canvas with a light background and a dark subject in the center
    const canvas = createCanvas(100, 100);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#e8e0d5"; // light wall
    ctx.fillRect(0, 0, 100, 100);

    // Subject (person)
    ctx.fillStyle = "#1e293b";
    ctx.beginPath();
    ctx.arc(50, 50, 30, 0, Math.PI * 2);
    ctx.fill();

    const resultDataUrl = await removeBackgroundMatte(canvas, {
      tolerance: 40,
      feather: 6,
    });

    expect(resultDataUrl).toBeDefined();
    expect(resultDataUrl.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("applies bottom fade to blend photo smoothly into dark flyer backgrounds", () => {
    const canvas = createCanvas(100, 100);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 100, 100);

    // Apply 30% bottom fade
    applyPhotoStyle(canvas, { bottomFade: 30 });

    const imgData = ctx.getImageData(0, 0, 100, 100).data;
    // Top pixel alpha should remain 255
    const topAlpha = imgData[(20 * 100 + 50) * 4 + 3];
    // Bottom pixel alpha should fade towards 0
    const btmAlpha = imgData[(99 * 100 + 50) * 4 + 3];

    expect(topAlpha).toBe(255);
    expect(btmAlpha).toBeLessThan(30);
  });

  it("applies flyer-match warm cinema color grading", () => {
    const canvas = createCanvas(10, 10);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#808080"; // mid gray
    ctx.fillRect(0, 0, 10, 10);

    applyPhotoStyle(canvas, { style: "flyer-match" });

    const imgData = ctx.getImageData(0, 0, 10, 10).data;
    const r = imgData[0];
    const g = imgData[1];
    const b = imgData[2];

    // In warm cinema/flyer match, red channel is boosted more than blue
    expect(r).toBeGreaterThan(b);
  });

  it("applies dramatic-bw monochrome grading", () => {
    const canvas = createCanvas(10, 10);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ff5522";
    ctx.fillRect(0, 0, 10, 10);

    applyPhotoStyle(canvas, { style: "dramatic-bw" });

    const imgData = ctx.getImageData(0, 0, 10, 10).data;
    const r = imgData[0];
    const g = imgData[1];
    const b = imgData[2];

    // In monochrome, R, G, B are equal
    expect(r).toBe(g);
    expect(g).toBe(b);
  });
});
