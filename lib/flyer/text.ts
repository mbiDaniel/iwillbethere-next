import { createCanvas, CanvasInstance } from "./canvas";
import { PlaceholderTextStyle } from "./types";

export interface TextLayoutOptions {
  maxLines?: number;
  maxLength?: number;
  align?: "left" | "center" | "right";
  minFontSize?: number;
  maxFontSize?: number;
}

export interface FittedTextLayout {
  fontSize: number;
  lines: string[];
  lineHeight: number;
  totalHeight: number;
  truncated: boolean;
}

/**
 * Builds a CSS font string for canvas context.
 */
export function buildCanvasFont(
  style: PlaceholderTextStyle,
  fontSize: number
): string {
  const fontStyle = style.fontStyle ?? "normal";
  const fontWeight = style.fontWeight ?? 400;
  const family = style.fontFamily || "sans-serif";
  return `${fontStyle} ${fontWeight} ${fontSize}px "${family}", sans-serif`;
}

/**
 * Wraps text into lines given a max width and font settings.
 */
export function wrapText(
  ctx: any,
  text: string,
  maxWidth: number,
  maxLines: number = 1
): { lines: string[]; truncated: boolean } {
  const words = text.split(/\s+/);
  if (words.length === 0 || !text.trim()) {
    return { lines: [""], truncated: false };
  }

  const lines: string[] = [];
  let currentLine = words[0];

  for (let i = 1; i < words.length; i++) {
    const word = words[i];
    const testLine = `${currentLine} ${word}`;
    const metrics = ctx.measureText(testLine);

    if (metrics.width <= maxWidth) {
      currentLine = testLine;
    } else {
      lines.push(currentLine);
      if (lines.length === maxLines) {
        // Can't add more lines, truncate remaining
        const remaining = words.slice(i).join(" ");
        let truncatedLine = currentLine;
        while (truncatedLine.length > 0 && ctx.measureText(`${truncatedLine}…`).width > maxWidth) {
          truncatedLine = truncatedLine.slice(0, -1);
        }
        lines[lines.length - 1] = `${truncatedLine}…`;
        return { lines, truncated: true };
      }
      currentLine = word;
    }
  }

  // Check if final line fits
  if (ctx.measureText(currentLine).width > maxWidth) {
    if (lines.length + 1 > maxLines) {
      let truncatedLine = currentLine;
      while (truncatedLine.length > 0 && ctx.measureText(`${truncatedLine}…`).width > maxWidth) {
        truncatedLine = truncatedLine.slice(0, -1);
      }
      lines.push(`${truncatedLine}…`);
      return { lines, truncated: true };
    } else {
      // Single long word or string exceeding maxWidth
      let truncatedLine = currentLine;
      while (truncatedLine.length > 0 && ctx.measureText(`${truncatedLine}…`).width > maxWidth) {
        truncatedLine = truncatedLine.slice(0, -1);
      }
      lines.push(`${truncatedLine}…`);
      return { lines, truncated: true };
    }
  }

  lines.push(currentLine);
  return { lines, truncated: false };
}

/**
 * Calculates the optimal font size and line wrapping to fit within a bounded box.
 */
export function fitTextToBox(
  text: string,
  boxWidth: number,
  boxHeight: number,
  style: PlaceholderTextStyle,
  options: TextLayoutOptions = {}
): FittedTextLayout {
  const cleanText = text.slice(0, options.maxLength ?? 200).trim();
  const maxLines = Math.max(1, options.maxLines ?? 1);
  const minFont = Math.max(6, options.minFontSize ?? 10);
  const maxFont = Math.max(minFont, options.maxFontSize ?? style.fontSize ?? 48);

  const measureCanvas = createCanvas(100, 100);
  const ctx = measureCanvas.getContext("2d");

  let low = minFont;
  let high = maxFont;
  let bestFontSize = minFont;
  let bestLines: string[] = [cleanText];
  let bestTruncated = false;
  let bestLineHeight = minFont * 1.2;

  // Step down from maxFont to minFont to find the largest fitting font size
  for (let size = high; size >= low; size -= 1) {
    ctx.font = buildCanvasFont(style, size);
    if (style.tracking && "letterSpacing" in ctx) {
      ctx.letterSpacing = `${style.tracking}px`;
    }

    const lineHeight = style.lineHeight ? Math.round(size * (style.lineHeight / size)) : Math.round(size * 1.2);
    const { lines, truncated } = wrapText(ctx, cleanText, boxWidth, maxLines);
    const totalHeight = lines.length * lineHeight;

    if (!truncated && totalHeight <= boxHeight) {
      // It fits perfectly without truncation!
      bestFontSize = size;
      bestLines = lines;
      bestTruncated = false;
      bestLineHeight = lineHeight;
      break;
    }

    if (size === low) {
      // If even at minimum font size it doesn't fit, use minimum font and wrap/truncate
      bestFontSize = low;
      bestLines = lines;
      bestTruncated = truncated || totalHeight > boxHeight;
      bestLineHeight = lineHeight;
    }
  }

  return {
    fontSize: bestFontSize,
    lines: bestLines,
    lineHeight: bestLineHeight,
    totalHeight: bestLines.length * bestLineHeight,
    truncated: bestTruncated,
  };
}

/**
 * Renders fitted text onto a destination canvas context.
 */
export function renderFittedText(
  ctx: any,
  layout: FittedTextLayout,
  boxX: number,
  boxY: number,
  boxWidth: number,
  boxHeight: number,
  style: PlaceholderTextStyle,
  options: TextLayoutOptions = {}
): void {
  ctx.save();

  ctx.font = buildCanvasFont(style, layout.fontSize);
  ctx.fillStyle = style.color || "#ffffff";
  ctx.textBaseline = "middle";

  if (style.tracking && "letterSpacing" in ctx) {
    ctx.letterSpacing = `${style.tracking}px`;
  }
  if (style.direction && "direction" in ctx) {
    ctx.direction = style.direction;
  }

  const align = options.align ?? "left";
  ctx.textAlign = align;

  let startX = boxX;
  if (align === "center") {
    startX = boxX + boxWidth / 2;
  } else if (align === "right") {
    startX = boxX + boxWidth;
  }

  // Vertically center lines in the box
  const startY = boxY + (boxHeight - layout.totalHeight) / 2 + layout.lineHeight / 2;

  for (let i = 0; i < layout.lines.length; i++) {
    const y = startY + i * layout.lineHeight;
    ctx.fillText(layout.lines[i], startX, y);
  }

  ctx.restore();
}
