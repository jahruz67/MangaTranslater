// SSE events may span network chunks, including a split UTF-8 character or CRLF.
export async function readEventStream(response, extract, signal) {
  if (!response.body) throw new Error("API stream has no response body.");
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let pending = "", data = [], output = "", received = 0, doneEvent = false;
  const abort = () => { reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  function dispatch() {
    if (!data.length) return;
    const value = data.join("\n"); data = [];
    if (value.trim() === "[DONE]") { doneEvent = true; return; }
    let parsed;
    try { parsed = JSON.parse(value); } catch { throw new Error("Malformed API stream response."); }
    if (parsed.error) throw new Error("The API provider interrupted the stream. Try smaller OCR tiles or retry later.");
    const text = extract(parsed);
    if (typeof text !== "string") throw new Error("Malformed text in API stream.");
    output += text;
  }
  function lines(flush = false) {
    let end;
    while ((end = pending.indexOf("\n")) !== -1 && !doneEvent) {
      const line = pending.slice(0, end).replace(/\r$/, ""); pending = pending.slice(end+1);
      if (!line) dispatch();
      else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
    }
    if (flush && !doneEvent) {
      if (pending.startsWith("data:")) data.push(pending.slice(5).trim());
      pending = ""; dispatch();
    }
  }
  try {
    signal.throwIfAborted();
    while (!doneEvent) {
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      if (done) { pending += decoder.decode(); lines(true); break; }
      received += value.byteLength;
      if (received > 2000000) throw new Error("API stream too large. Reduce OCR tile size.");
      pending += decoder.decode(value, { stream: true }); lines();
    }
    return output;
  } finally {
    signal.removeEventListener("abort", abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
