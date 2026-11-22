export interface AssetUploadTask {
  kind: "slice" | "mask";
  tier: "preview" | "full";
  sha256: string;
  blob: Blob;
  key: string;
  uploadUrl: string;
  alreadyExists: boolean;
  contentType: string;
}

export interface UploadProgressInfo {
  completedCount: number;
  totalCount: number;
  uploadedBytes: number;
  totalBytes: number;
  currentFilename?: string;
  percent: number;
}

/**
 * Uploads assets in parallel with concurrency limit, exponential backoff retries, and abort support.
 */
export async function uploadAssetsConcurrently(
  tasks: AssetUploadTask[],
  options: {
    concurrency?: number;
    maxRetries?: number;
    signal?: AbortSignal;
    onProgress?: (info: UploadProgressInfo) => void;
  } = {}
): Promise<void> {
  const concurrency = options.concurrency ?? 4;
  const maxRetries = options.maxRetries ?? 3;
  const signal = options.signal;
  const onProgress = options.onProgress ?? (() => {});

  const totalCount = tasks.length;
  const totalBytes = tasks.reduce((sum, t) => sum + t.blob.size, 0);
  let completedCount = 0;
  let uploadedBytes = 0;

  async function uploadWithRetry(task: AssetUploadTask): Promise<void> {
    if (signal?.aborted) {
      throw new Error("Upload aborted by user.");
    }

    if (task.alreadyExists) {
      completedCount++;
      uploadedBytes += task.blob.size;
      onProgress({
        completedCount,
        totalCount,
        uploadedBytes,
        totalBytes,
        percent: totalBytes > 0 ? Math.round((uploadedBytes / totalBytes) * 100) : 100,
      });
      return;
    }

    let attempt = 0;
    while (attempt <= maxRetries) {
      if (signal?.aborted) {
        throw new Error("Upload aborted by user.");
      }

      try {
        const response = await fetch(task.uploadUrl, {
          method: "PUT",
          body: task.blob,
          headers: {
            "Content-Type": task.contentType,
          },
          signal,
        });

        if (!response.ok) {
          throw new Error(`Upload HTTP error: ${response.status} ${response.statusText}`);
        }

        completedCount++;
        uploadedBytes += task.blob.size;
        onProgress({
          completedCount,
          totalCount,
          uploadedBytes,
          totalBytes,
          percent: totalBytes > 0 ? Math.round((uploadedBytes / totalBytes) * 100) : 100,
        });
        return;
      } catch (err: unknown) {
        attempt++;
        if (attempt > maxRetries || signal?.aborted) {
          throw err instanceof Error ? err : new Error(String(err));
        }
        // Exponential backoff: 300ms, 600ms, 1200ms...
        const delay = Math.pow(2, attempt) * 150;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  // Work pool with concurrency limit
  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
    while (index < tasks.length) {
      if (signal?.aborted) {
        throw new Error("Upload aborted by user.");
      }
      const currentTask = tasks[index++];
      await uploadWithRetry(currentTask);
    }
  });

  await Promise.all(workers);
}
