import { slicePsd, SliceOptions } from "./slice";

/**
 * Web Worker for off-thread PSD parsing, slicing, and encoding.
 */
self.onmessage = async (e: MessageEvent) => {
  const { type, buffer, options } = e.data;

  if (type === "SLICE_PSD") {
    try {
      const result = await slicePsd(buffer, {
        ...options,
        onProgress: (step, percent) => {
          self.postMessage({
            type: "PROGRESS",
            step,
            percent,
          });
        },
      });

      self.postMessage({
        type: "SUCCESS",
        result,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      self.postMessage({
        type: "ERROR",
        error: msg,
      });
    }
  }
};
