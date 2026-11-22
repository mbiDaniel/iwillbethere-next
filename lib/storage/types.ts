export interface StorageService {
  putObject(
    bucket: string,
    key: string,
    body: Buffer | Uint8Array | string,
    contentType?: string,
    cacheControl?: string
  ): Promise<void>;
  getObject(bucket: string, key: string): Promise<Buffer>;
  headObject(
    bucket: string,
    key: string
  ): Promise<{ contentLength: number; contentType?: string } | null>;
  getRange(bucket: string, key: string, start: number, end: number): Promise<Buffer>;
  deleteObject(bucket: string, key: string): Promise<void>;
  deletePrefix(bucket: string, prefix: string): Promise<void>;
  getSignedUploadUrl(
    bucket: string,
    key: string,
    contentType: string,
    maxSizeBytes?: number,
    expiresInSeconds?: number
  ): Promise<string>;
  getSignedDownloadUrl(
    bucket: string,
    key: string,
    expiresInSeconds?: number
  ): Promise<string>;
  getPublicUrl(key: string): string;
}

export type FileType = "psd" | "font";

export function verifyMagicBytes(buffer: Buffer, type: FileType): { valid: boolean; format?: string } {
  if (buffer.length < 4) return { valid: false };

  if (type === "psd") {
    // PSD magic bytes: 8BPS (0x38 0x42 0x50 0x53)
    const isPsd =
      buffer[0] === 0x38 &&
      buffer[1] === 0x42 &&
      buffer[2] === 0x50 &&
      buffer[3] === 0x53;
    return { valid: isPsd, format: isPsd ? "psd" : undefined };
  }

  if (type === "font") {
    // TrueType: 0x00 0x01 0x00 0x00 or 'true' (0x74 0x72 0x75 0x65)
    const isTtf =
      (buffer[0] === 0x00 && buffer[1] === 0x01 && buffer[2] === 0x00 && buffer[3] === 0x00) ||
      (buffer[0] === 0x74 && buffer[1] === 0x72 && buffer[2] === 0x75 && buffer[3] === 0x65);

    // OpenType: 'OTTO' (0x4F 0x54 0x54 0x4F)
    const isOtf =
      buffer[0] === 0x4f && buffer[1] === 0x54 && buffer[2] === 0x54 && buffer[3] === 0x4f;

    // WOFF: 'wOFF' (0x77 0x4F 0x46 0x46)
    const isWoff =
      buffer[0] === 0x77 && buffer[1] === 0x4f && buffer[2] === 0x46 && buffer[3] === 0x46;

    // WOFF2: 'wOF2' (0x77 0x4F 0x46 0x32)
    const isWoff2 =
      buffer[0] === 0x77 && buffer[1] === 0x4f && buffer[2] === 0x46 && buffer[3] === 0x32;

    if (isTtf) return { valid: true, format: "ttf" };
    if (isOtf) return { valid: true, format: "otf" };
    if (isWoff) return { valid: true, format: "woff" };
    if (isWoff2) return { valid: true, format: "woff2" };
    return { valid: false };
  }

  return { valid: false };
}
