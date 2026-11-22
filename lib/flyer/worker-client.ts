import { SlicerResult, SliceOptions } from "./slice";
import type { PsdLayerDescriptor } from "./detect";

export async function inspectPsdLayersInWorker(
  buffer: ArrayBuffer,
  prefix = "#PLACEHOLDER_"
): Promise<PsdLayerDescriptor[]> {
  if (typeof window !== "undefined" && typeof Worker !== "undefined") {
    return await new Promise<PsdLayerDescriptor[]>((resolve, reject) => {
      const worker = new Worker(new URL("./psd-worker.ts", import.meta.url), {
        type: "module",
      });
      worker.onmessage = (event) => {
        if (event.data.type === "LAYERS") {
          worker.terminate();
          resolve(event.data.layers);
        } else if (event.data.type === "ERROR") {
          worker.terminate();
          reject(new Error(event.data.error || "Could not inspect PSD layers"));
        }
      };
      worker.onerror = (event) => {
        worker.terminate();
        reject(new Error(event.message || "Could not inspect PSD layers"));
      };

      const transferableBuffer = buffer.slice(0);
      worker.postMessage(
        { type: "INSPECT_PSD", buffer: transferableBuffer, options: { prefix } },
        [transferableBuffer]
      );
    });
  }

  const { inspectPsdLayers } = await import("./slice");
  return inspectPsdLayers(buffer, prefix);
}

export type SlicerProgressCallback = (
  step: "reading" | "parsing" | "detecting" | "slicing" | "encoding" | "verifying",
  percent: number
) => void;

/**
 * Runs PSD slicing in a background Web Worker when available,
 * falling back to direct execution if Workers are not supported or fail to spawn.
 */
export async function runPsdSlicer(
  buffer: ArrayBuffer | Uint8Array,
  options: SliceOptions = {}
): Promise<SlicerResult> {
  const onProgress = options.onProgress ?? (() => {});

  if (typeof window !== "undefined" && typeof Worker !== "undefined") {
    try {
      return await new Promise<SlicerResult>((resolve, reject) => {
        const worker = new Worker(new URL("./psd-worker.ts", import.meta.url), {
          type: "module",
        });

        worker.onmessage = (event) => {
          const { type, step, percent, result, error } = event.data;
          if (type === "PROGRESS") {
            onProgress(step, percent);
          } else if (type === "SUCCESS") {
            worker.terminate();
            resolve(result);
          } else if (type === "ERROR") {
            worker.terminate();
            reject(new Error(error || "Worker error occurred while slicing PSD"));
          }
        };

        worker.onerror = (err) => {
          worker.terminate();
          reject(new Error(err.message || "Worker error"));
        };

        const transferBuf = buffer instanceof Uint8Array ? buffer.buffer : buffer;
        worker.postMessage(
          {
            type: "SLICE_PSD",
            buffer: transferBuf,
            options: {
              ...options,
              onProgress: undefined, // cannot pass function over postMessage
            },
          },
          [transferBuf]
        );
      });
    } catch (workerErr) {
      console.warn("Web Worker spawn failed, falling back to main thread:", workerErr);
    }
  }

  // Fallback to direct thread execution
  const { slicePsd } = await import("./slice");
  return await slicePsd(buffer, options);
}
