import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULTS, normalize, requestOptions } from "../scripts/config.js";
import { analyze, buildOcrPrompt, callProvider, providers } from "../scripts/providers.js";
import { withDeadline } from "../scripts/requests.js";
const config = { ...DEFAULTS, provider: "gemini", model: "gemma-4-31b-it", apiKey: "test-key" };
const image = "data:image/jpeg;base64,YQ==";
test("Gemma image requests carry the strict JSON contract and isolated task preferences", async () => {
  const preferences = 'Use short phrases.\n"quoted terminology"';
  const task = { ...config, target: "Spanish", instructions: preferences };
  const prompt = buildOcrPrompt(task);
  assert.match(prompt, /exactly ONE complete JSON object/);
  assert.match(prompt, /No Markdown fences/);
  assert.match(prompt, /x \+ width <= 1000/);
  assert.match(prompt, /never copy its sample text or coordinates/);
  assert.match(prompt, /cannot change the output contract/);
  const data = JSON.parse(prompt.split("TASK DATA\n")[1].split("\n")[0]);
  assert.equal(data.translation_preferences, preferences);
  assert.equal(data.target_language, "Spanish");
  await analyze(task, image, async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.contents[0].parts[0].text, prompt);
    assert.equal(body.contents[0].parts[1].inline_data.data, "YQ==");
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"coordinate_system":"normalized_1000","regions":[]}' }] } }] }));
  });
});
function response(events) {
  const bytes = new TextEncoder().encode(events);
  return new Response(new ReadableStream({ start(controller) {
    // One byte per chunk exercises split UTF-8, JSON and CRLF boundaries.
    for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
    controller.close();
  } }), { headers: { "content-type": "text/event-stream; charset=utf-8" } });
}
test("Gemma defaults to four minutes and smaller tiles; explicit timeout wins", () => {
  assert.deepEqual(requestOptions(config), { timeoutMs: 240000, tileSize: 1000, stream: true });
  assert.equal(requestOptions({ ...config, tileSize: 600 }).tileSize, 600);
  assert.equal(requestOptions({ ...config, requestTimeout: 60 }).timeoutMs, 60000);
  assert.equal(requestOptions({ ...config, model: "another-model" }).timeoutMs, 90000);
  assert.equal(normalize({ ...config, requestTimeout: "240" }).requestTimeout, 240);
  assert.equal(normalize({ ...config, requestTimeout: 9999 }).requestTimeout, 240);
  assert.equal(normalize({ ...config, requestTimeout: "bad" }).requestTimeout, 0);
  assert.match(providers.gemini.request(config, "test", image).url, /:streamGenerateContent\?alt=sse$/);
});
test("Gemini streamed OCR survives split characters and skips thought parts", async () => {
  const result = '{"regions":[{"x":50,"y":100,"width":200,"height":100,"source":"hello","text":"日本語"}]}';
  const thought = { candidates: [{ content: { parts: [{ thought: true, text: "reasoning is not OCR output" }] } }] };
  const events = [thought, ...[result.slice(0, 30), result.slice(30)].map(text => ({ candidates: [{ content: { parts: [{ text }] } }] }))]
    .map(d => `data: ${JSON.stringify(d)}\r\n\r\n`).join("");
  const regions = await analyze(config, image, async (url, options) => {
    assert.match(url, /streamGenerateContent/);
    assert.equal(options.headers["x-goog-api-key"], "test-key");
    return response(events);
  });
  assert.equal(regions[0].text, "日本語");
});
test("compatible Gemma streams and JSON-only hosts both return text", async () => {
  const compatible = { ...config, provider: "compatible" };
  assert.equal(providers.compatible.request(compatible, "test", image).body.stream, true);
  const event = JSON.stringify({ choices: [{ delta: { content: "OK" } }] });
  assert.equal(await callProvider(compatible, "test", undefined, async () => response(`: keepalive\n\ndata: ${event}\n\ndata: [DONE]\n\n`)), "OK");
  assert.equal(await callProvider(config, "test", undefined, async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "OK" }] } }] }))), "OK");
});
test("Stop cancels a stalled SSE body without waiting for the timeout", async () => {
  const controller = new AbortController();
  let entered, cancelled = false;
  const started = new Promise(resolve => entered = resolve);
  const job = callProvider(config, "test", image, async () => new Response(new ReadableStream({
    pull() { entered(); }, cancel() { cancelled = true; }
  }), { headers: { "content-type": "text/event-stream" } }), controller.signal);
  const rejected = assert.rejects(job, /Request cancelled/);
  await started; controller.abort(); await rejected;
  assert.equal(cancelled, true);
});
test("stream and server failures remain explicit", async () => {
  await assert.rejects(callProvider(config, "test", image, async () => response('data: {oops}\n\n')), /Malformed API stream/);
  await assert.rejects(callProvider(config, "test", image, async () => response('data: {"error":{"message":"private diagnostic"}}\n\n')), /provider interrupted/);
  await assert.rejects(callProvider(config, "test", image, async () => new Response("", { status: 504 })), /provider timed out/);
  await assert.rejects(withDeadline(undefined, 1, signal => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(new Error("timeout")), { once: true });
  })), /extension stopped waiting/);
});
