import { createCanvas } from "@napi-rs/canvas";
import { initializeCanvas, writePsd } from "ag-psd";
import fs from "fs";
import path from "path";

initializeCanvas(createCanvas as any);

const FIXTURES_DIR = path.join(process.cwd(), "tests", "fixtures");

export function createValidFixturePsd(): Buffer {
  const width = 800;
  const height = 800;

  // Background canvas
  const bgCanvas = createCanvas(width, height);
  const bgCtx = bgCanvas.getContext("2d");
  bgCtx.fillStyle = "#111111";
  bgCtx.fillRect(0, 0, width, height);

  // Photo placeholder canvas with transparent circle (mask)
  const photoCanvas = createCanvas(200, 200);
  const photoCtx = photoCanvas.getContext("2d");
  photoCtx.fillStyle = "#ffffff";
  photoCtx.beginPath();
  photoCtx.arc(100, 100, 90, 0, Math.PI * 2);
  photoCtx.fill();

  // Decorative border/overlay canvas (sits above the photo)
  const decoCanvas = createCanvas(width, height);
  const decoCtx = decoCanvas.getContext("2d");
  decoCtx.strokeStyle = "#ffdd00";
  decoCtx.lineWidth = 10;
  decoCtx.strokeRect(20, 20, width - 40, height - 40);

  const psd = {
    width,
    height,
    children: [
      // Top layer: decorative border above everything
      {
        name: "Decorative Border",
        canvas: decoCanvas,
        left: 0,
        top: 0,
        right: width,
        bottom: height,
      },
      // Group: Placeholders
      {
        name: "Guest Content Group",
        children: [
          {
            name: "#PLACEHOLDER_name",
            text: {
              text: "Jamie Park",
              style: {
                font: { name: "Arial" },
                fontSize: 32,
                fillColor: { r: 255, g: 255, b: 255 },
              },
            },
            left: 50,
            top: 600,
            right: 500,
            bottom: 660,
          },
          {
            name: "#PLACEHOLDER_photo",
            canvas: photoCanvas,
            left: 50,
            top: 350,
            right: 250,
            bottom: 550,
          },
        ],
      },
      // Bottom layer: Background
      {
        name: "Background",
        canvas: bgCanvas,
        left: 0,
        top: 0,
        right: width,
        bottom: height,
      },
    ],
  };

  return Buffer.from(writePsd(psd as any));
}

export function createSmartObjectFixturePsd(): Buffer {
  const width = 500;
  const height = 500;
  const psd = {
    width,
    height,
    children: [
      {
        name: "#PLACEHOLDER_photo",
        placedLayer: {
          id: "20953ddb-9391-11ec-b4f1-c15674f50bc4",
          type: "raster",
          width: 200,
          height: 200,
          transform: [0, 0, 100, 0, 100, 100, 0, 100],
        }, // Smart object
        left: 50,
        top: 50,
        right: 250,
        bottom: 250,
      },
      {
        name: "#PLACEHOLDER_name",
        text: { text: "Guest", style: { font: { name: "Arial" }, fontSize: 24 } },
        left: 50,
        top: 300,
        right: 300,
        bottom: 350,
      },
    ],
  };
  return Buffer.from(writePsd(psd as any));
}

export function createMissingFontFixturePsd(): Buffer {
  const width = 500;
  const height = 500;
  const psd = {
    width,
    height,
    children: [
      {
        name: "#PLACEHOLDER_name",
        text: {
          text: "Guest",
          style: {
            font: { name: "ExoticFontNonExistent" },
            fontSize: 24,
          },
        },
        left: 50,
        top: 50,
        right: 400,
        bottom: 100,
      },
    ],
  };
  return Buffer.from(writePsd(psd));
}

export function createDuplicateConflictingKeysFixturePsd(): Buffer {
  const width = 500;
  const height = 500;
  const canvas = createCanvas(100, 100);
  const psd = {
    width,
    height,
    children: [
      {
        name: "#PLACEHOLDER_badge",
        text: { text: "VIP", style: { font: { name: "Arial" }, fontSize: 20 } },
        left: 50,
        top: 50,
        right: 200,
        bottom: 100,
      },
      {
        name: "#PLACEHOLDER_badge", // Same key, but image type!
        canvas,
        left: 50,
        top: 150,
        right: 150,
        bottom: 250,
      },
    ],
  };
  return Buffer.from(writePsd(psd as any));
}

export function createZeroPlaceholdersFixturePsd(): Buffer {
  const width = 500;
  const height = 500;
  const canvas = createCanvas(width, height);
  const psd = {
    width,
    height,
    children: [
      {
        name: "Background",
        canvas,
        left: 0,
        top: 0,
        right: width,
        bottom: height,
      },
      {
        name: "Title Text",
        text: { text: "Party", style: { font: { name: "Arial" }, fontSize: 40 } },
        left: 50,
        top: 50,
        right: 400,
        bottom: 150,
      },
    ],
  };
  return Buffer.from(writePsd(psd as any));
}

export function generateAllFixtures() {
  if (!fs.existsSync(FIXTURES_DIR)) {
    fs.mkdirSync(FIXTURES_DIR, { recursive: true });
  }

  fs.writeFileSync(path.join(FIXTURES_DIR, "valid-event.psd"), createValidFixturePsd());
  fs.writeFileSync(path.join(FIXTURES_DIR, "smart-object.psd"), createSmartObjectFixturePsd());
  fs.writeFileSync(path.join(FIXTURES_DIR, "missing-font.psd"), createMissingFontFixturePsd());
  fs.writeFileSync(path.join(FIXTURES_DIR, "duplicate-conflict.psd"), createDuplicateConflictingKeysFixturePsd());
  fs.writeFileSync(path.join(FIXTURES_DIR, "zero-placeholders.psd"), createZeroPlaceholdersFixturePsd());

  console.log("✅ Test PSD fixtures generated in", FIXTURES_DIR);
}

if (process.argv[1]?.endsWith("generate-fixtures.ts")) {
  generateAllFixtures();
}
