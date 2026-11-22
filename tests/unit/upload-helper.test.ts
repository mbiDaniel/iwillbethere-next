import { describe, it, expect, vi, beforeEach } from "vitest";
import { uploadFileWithFallback } from "@/lib/upload-helper";

describe("uploadFileWithFallback", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("completes upload directly when R2 presigned PUT succeeds", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    });
    global.fetch = fetchMock;

    const file = new Blob(["test-psd-content"], { type: "image/vnd.adobe.photoshop" });
    await expect(
      uploadFileWithFallback(
        file,
        "https://r2.example.com/events/123/psd.psd",
        "events/123/psd.psd",
        "private",
        "image/vnd.adobe.photoshop"
      )
    ).resolves.toBeUndefined();

    // Verify direct upload was attempted
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://r2.example.com/events/123/psd.psd",
      expect.objectContaining({
        method: "PUT",
        headers: { "Content-Type": "image/vnd.adobe.photoshop" },
      })
    );
  });

  it("falls back to /api/upload when direct R2 upload fails or encounters CORS", async () => {
    const fetchMock = vi
      .fn()
      // First call: direct PUT to R2 fails (e.g. CORS preflight rejection / TypeError)
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      // Second call: fallback to /api/upload succeeds
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, key: "events/123/psd.psd" }),
      });
    global.fetch = fetchMock;

    const file = new Blob(["test-psd-content"], { type: "image/vnd.adobe.photoshop" });
    await expect(
      uploadFileWithFallback(
        file,
        "https://r2.example.com/events/123/psd.psd",
        "events/123/psd.psd",
        "private",
        "image/vnd.adobe.photoshop"
      )
    ).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Second call is to the /api/upload proxy
    expect(fetchMock.mock.calls[1][0]).toContain("/api/upload?key=events%2F123%2Fpsd.psd&bucket=private");
  });

  it("throws clear error if both direct R2 and fallback proxy fail", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: "Storage service unavailable" }),
      });
    global.fetch = fetchMock;

    const file = new Blob(["test-content"], { type: "image/vnd.adobe.photoshop" });
    await expect(
      uploadFileWithFallback(
        file,
        "https://r2.example.com/events/123/psd.psd",
        "events/123/psd.psd",
        "private",
        "image/vnd.adobe.photoshop"
      )
    ).rejects.toThrow("Storage service unavailable");
  });

  it("directly uploads to local endpoint when uploadUrl is a local path", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    });
    global.fetch = fetchMock;

    const file = new Blob(["test-psd-content"], { type: "image/vnd.adobe.photoshop" });
    await expect(
      uploadFileWithFallback(
        file,
        "/api/upload?key=events/123/psd.psd&bucket=private",
        "events/123/psd.psd",
        "private",
        "image/vnd.adobe.photoshop"
      )
    ).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/upload?key=events/123/psd.psd&bucket=private",
      expect.objectContaining({
        method: "PUT",
        headers: { "Content-Type": "image/vnd.adobe.photoshop" },
      })
    );
  });
});
