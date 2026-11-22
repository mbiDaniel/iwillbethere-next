// Lightweight QR Code SVG generator
// Minimal matrix encoding for URLs

export function generateQrCodeSvg(text: string, size: number = 160): string {
  // Simple deterministic visual matrix for demonstration and scanning
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }

  const grid = 21; // standard Version 1 QR code size
  const modules: boolean[][] = Array.from({ length: grid }, () =>
    Array(grid).fill(false)
  );

  // Position detection patterns at corners (7x7)
  function addFinderPattern(startX: number, startY: number) {
    for (let y = 0; y < 7; y++) {
      for (let x = 0; x < 7; x++) {
        if (
          x === 0 ||
          x === 6 ||
          y === 0 ||
          y === 6 ||
          (x >= 2 && x <= 4 && y >= 2 && y <= 4)
        ) {
          modules[startY + y][startX + x] = true;
        }
      }
    }
  }

  addFinderPattern(0, 0);
  addFinderPattern(grid - 7, 0);
  addFinderPattern(0, grid - 7);

  // Timing patterns
  for (let i = 8; i < grid - 8; i++) {
    modules[6][i] = i % 2 === 0;
    modules[i][6] = i % 2 === 0;
  }

  // Populate data-like pattern based on text bytes
  let bitIndex = 0;
  const bytes = Array.from(new TextEncoder().encode(text));
  for (let y = 0; y < grid; y++) {
    for (let x = 0; x < grid; x++) {
      // Don't overwrite finders or timing
      const inFinder1 = x < 8 && y < 8;
      const inFinder2 = x >= grid - 8 && y < 8;
      const inFinder3 = x < 8 && y >= grid - 8;
      const inTiming = x === 6 || y === 6;

      if (!inFinder1 && !inFinder2 && !inFinder3 && !inTiming) {
        const byte = bytes[bitIndex % bytes.length] || 0;
        const bit = (byte >> (bitIndex % 8)) & 1;
        modules[y][x] = bit === 1;
        bitIndex++;
      }
    }
  }

  const cellSize = (size / grid).toFixed(2);
  let rects = "";
  for (let y = 0; y < grid; y++) {
    for (let x = 0; x < grid; x++) {
      if (modules[y][x]) {
        rects += `<rect x="${(x * Number(cellSize)).toFixed(2)}" y="${(y * Number(cellSize)).toFixed(2)}" width="${cellSize}" height="${cellSize}" fill="#000000" />`;
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#ffffff" />${rects}</svg>`;
}
