/**
 * Upload helper that attempts direct upload via presigned S3/R2 URL,
 * and automatically falls back to the server-side upload proxy (/api/upload)
 * if direct upload fails (e.g. CORS not configured on the R2 bucket).
 */
export async function uploadFileWithFallback(
  file: File | Blob,
  uploadUrl: string,
  key: string,
  bucket: "private" | "public",
  contentType: string
): Promise<void> {
  // If uploadUrl is local (e.g. /api/upload), upload locally directly for max speed
  if (uploadUrl.startsWith("/") || uploadUrl.includes("/api/upload")) {
    const proxyUrl = uploadUrl.startsWith("/")
      ? uploadUrl
      : `/api/upload?key=${encodeURIComponent(key)}&bucket=${bucket}`;

    const localRes = await fetch(proxyUrl, {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: file,
    });

    if (!localRes.ok) {
      const errJson = await localRes.json().catch(() => ({}));
      throw new Error(
        errJson.error || `Upload failed with status ${localRes.status}`
      );
    }
    return;
  }

  let directFailed = false;

  try {
    const directRes = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: file,
    });

    if (directRes.ok) {
      return;
    }
    console.warn(
      `Direct R2 upload responded with ${directRes.status}: ${directRes.statusText}. Falling back to upload proxy...`
    );
    directFailed = true;
  } catch (err) {
    console.warn(
      "Direct R2 upload threw an error (likely bucket CORS). Falling back to upload proxy...",
      err
    );
    directFailed = true;
  }

  if (directFailed) {
    const proxyRes = await fetch(
      `/api/upload?key=${encodeURIComponent(key)}&bucket=${bucket}`,
      {
        method: "PUT",
        headers: { "Content-Type": contentType },
        body: file,
      }
    );

    if (!proxyRes.ok) {
      const errJson = await proxyRes.json().catch(() => ({}));
      throw new Error(
        errJson.error || `Upload failed via server proxy with status ${proxyRes.status}`
      );
    }
  }
}
