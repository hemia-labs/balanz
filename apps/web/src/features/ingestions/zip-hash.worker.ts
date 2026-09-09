// The native digest needs a buffer (bounded at 50 MiB). Keep both allocation
// and hashing off the UI thread; the owner terminates this worker on cancellation.
import { ZIP_MAX_BYTES } from "./upload-validation";

self.onmessage = async (event: MessageEvent<File>) => {
  try {
    if (!(event.data instanceof Blob) || event.data.size > ZIP_MAX_BYTES)
      throw new Error("Invalid ZIP size");
    const digest = await crypto.subtle.digest(
      "SHA-256",
      await event.data.arrayBuffer(),
    );
    self.postMessage({
      sha256: Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join(""),
    });
  } catch {
    self.postMessage({ error: "ZIP_HASH_FAILED" });
  }
};
