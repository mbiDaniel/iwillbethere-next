import { describe, it, expect } from "vitest";
import { generateVisitorHash, sanitizeSource } from "@/lib/analytics";
import { verifyMagicBytes } from "@/lib/storage";

describe("Analytics & Storage Magic Bytes - Unit Tests", () => {
  describe("Visitor Hashing", () => {
    it("generates deterministic hash for identical visitor and event on the same day", () => {
      const hash1 = generateVisitorHash("192.168.1.5", "Mozilla/5.0", "event_1");
      const hash2 = generateVisitorHash("192.168.1.5", "Mozilla/5.0", "event_1");
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(32);
    });

    it("generates different hashes for different events or IPs", () => {
      const hash1 = generateVisitorHash("192.168.1.5", "Mozilla/5.0", "event_1");
      const hash2 = generateVisitorHash("192.168.1.6", "Mozilla/5.0", "event_1");
      const hash3 = generateVisitorHash("192.168.1.5", "Mozilla/5.0", "event_2");

      expect(hash1).not.toBe(hash2);
      expect(hash1).not.toBe(hash3);
    });
  });

  describe("Source Sanitization", () => {
    it("allows approved UTM/referral sources and normalizes to lowercase", () => {
      expect(sanitizeSource("instagram")).toBe("instagram");
      expect(sanitizeSource("WHATSAPP")).toBe("whatsapp");
      expect(sanitizeSource("x")).toBe("x");
      expect(sanitizeSource("facebook")).toBe("facebook");
      expect(sanitizeSource("direct")).toBe("direct");
      expect(sanitizeSource("other")).toBe("other");
    });

    it("maps untrusted or unapproved sources to other", () => {
      expect(sanitizeSource("malicious_bot_string_123")).toBe("other");
      expect(sanitizeSource("<script>")).toBe("other");
      expect(sanitizeSource(null)).toBe("direct");
      expect(sanitizeSource(undefined)).toBe("direct");
    });
  });

  describe("Magic Bytes Verification", () => {
    it("recognizes PSD magic bytes (8BPS)", () => {
      const validPsd = Buffer.from([0x38, 0x42, 0x50, 0x53, 0x00, 0x01]);
      const invalid = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG header

      expect(verifyMagicBytes(validPsd, "psd")).toEqual({ valid: true, format: "psd" });
      expect(verifyMagicBytes(invalid, "psd")).toEqual({ valid: false });
    });

    it("recognizes TTF, OTF, WOFF, WOFF2 font signatures", () => {
      const ttf = Buffer.from([0x00, 0x01, 0x00, 0x00]);
      const otf = Buffer.from([0x4f, 0x54, 0x54, 0x4f]); // OTTO
      const woff2 = Buffer.from([0x77, 0x4f, 0x46, 0x32]); // wOF2
      const randomJunk = Buffer.from([0x12, 0x34, 0x56, 0x78]);

      expect(verifyMagicBytes(ttf, "font").valid).toBe(true);
      expect(verifyMagicBytes(otf, "font").valid).toBe(true);
      expect(verifyMagicBytes(woff2, "font").valid).toBe(true);
      expect(verifyMagicBytes(randomJunk, "font").valid).toBe(false);
    });
  });
});
