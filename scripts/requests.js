// Keep cancellation active until the response body has been read, not just headers.
export async function withDeadline(parent, milliseconds, job) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (parent?.aborted) abort();
  else parent?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, milliseconds);
  try {
    controller.signal.throwIfAborted();
    const value = await job(controller.signal);
    controller.signal.throwIfAborted();
    return value;
  } catch (error) {
    if (parent?.aborted) throw new Error("Request cancelled.");
    if (controller.signal.aborted) throw new Error(`The extension stopped waiting after ${Math.round(milliseconds/1000)} seconds. Increase Request timeout in Settings, reduce OCR tile size, or choose a faster model.`);
    throw error;
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener("abort", abort);
  }
}
