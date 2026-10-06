import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULTS, normalize, publicConfig, requireReady } from "../scripts/config.js";
import { analyze, callProvider, parseRegions, providers } from "../scripts/providers.js";
import "../scripts/render.js";
const config = { ...DEFAULTS, apiKey: "test-key", model: "test-vision" };
const region = { x: 50, y: 100, width: 200, height: 150, source: "hello", text: "Hola", background: "#ffffff" };
const image = "data:image/jpeg;base64,YQ==";
test("all provider requests can be cancelled during fetch or response-body reading", async () => {
  for (const provider of Object.keys(providers)) {
    for (const phase of ["fetch", "body"]) {
      const controller = new AbortController();
      let entered;
      const started = new Promise(resolve => entered = resolve);
      const blocked = signal => new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
        entered();
      });
      const job = callProvider({ ...config, provider }, "translate", image, async (_url, options) => {
        if (phase === "fetch") return blocked(options.signal);
        return { ok: true, json: () => blocked(options.signal) };
      }, controller.signal);
      const rejected = assert.rejects(job, /Request cancelled/);
      await started; controller.abort(); await rejected;
    }
  }
});
test("fresh configuration, key deletion, secret projection and normalization", () => {
  assert.throws(() => requireReady(DEFAULTS), /No API key configured/);
  assert.throws(() => requireReady({ ...config, model: "" }), /vision-capable/);
  assert.doesNotThrow(() => requireReady(config));
  const safe = publicConfig(config);
  assert.equal(safe.configured, true); assert.equal("apiKey" in safe, false); assert.equal("endpoint" in safe, false);
  assert.equal(publicConfig({ ...config, apiKey: "" }).configured, false);
  assert.equal(normalize({ ...config, tileSize: 5000 }).tileSize, 2000);
  assert.throws(() => normalize({ ...config, endpoint: "http://remote.example/v1" }), /HTTPS/);
  assert.doesNotThrow(() => normalize({ ...config, endpoint: "http://localhost:8080/v1" }));
  assert.throws(() => normalize({ ...config, endpoint: "https://user:secret@example.com" }), /credentials/);
  assert.throws(() => normalize({ ...config, endpoint: "https://example.com/?key=abc" }), /query/);
});
for (const provider of Object.keys(providers)) {
  test(`${provider} sends image to provider and extracts structured translation`, async () => {
    let sent;
    const text = JSON.stringify({ regions: [region] });
    const payloads = { compatible: { choices: [{ message: { content: text } }] },
      gemini: { candidates: [{ content: { parts: [{ text }] } }] }, anthropic: { content: [{ type: "text", text }] } };
    const result = await analyze({ ...config, provider, target: "Spanish" }, image, async (url, options) => {
      sent = { url, options }; return new Response(JSON.stringify(payloads[provider]), { status: 200 });
    });
    assert.deepEqual(result, [region]); assert.ok(sent.options.body.includes("Spanish"));
    assert.ok(sent.options.body.includes("YQ==")); assert.ok(!sent.options.body.includes(config.apiKey));
    assert.equal(sent.options.redirect, "error"); assert.equal(sent.options.credentials, "omit");
    assert.ok(Object.values(sent.options.headers).some(value => value.includes(config.apiKey)));
    assert.ok(!sent.url.includes(config.apiKey));
  });
}
test("model and target changes reach the request", async () => {
  let body;
  await analyze({ ...config, target: "Japanese", model: "another-model", detectSfx: true }, image, async (_url, options) => {
    body = JSON.parse(options.body); return new Response(JSON.stringify({ choices: [{ message: { content: '{"regions":[]}' } }] }));
  });
  assert.equal(body.model, "another-model"); assert.match(body.messages[0].content[0].text, /Japanese/);
  assert.match(body.messages[0].content[0].text, /Include sound effects/);
});
test("provider errors are actionable and never echo server data", async () => {
  for (const [status, code, pattern] of [[401, "", /Invalid API key/], [429, "", /rate limit/],
    [429, "insufficient_quota", /quota exhausted/], [404, "", /Unsupported model/], [413, "", /too large/], [500, "", /HTTP 500/]]) {
    await assert.rejects(callProvider(config, "test", null, async () => new Response(JSON.stringify({ error: { code, message: "sensitive server text" } }), { status })), pattern);
  }
  await assert.rejects(callProvider(config, "test", null, async () => { throw new Error("secret"); }), /network failure/);
  await assert.rejects(callProvider(config, "test", null, async () => new Response("not json")), /Malformed/);
  await assert.rejects(callProvider(config, "test", null, async () => new Response("{}")), /OCR failure/);
});
test("OCR validation rejects broken geometry and accepts fenced or empty results", () => {
  assert.deepEqual(parseRegions('```json\n{"regions":[]}\n```'), []);
  for (const text of ["null", "oops", "{}", JSON.stringify({ regions: [{ ...region, width: -1 }] }),
    JSON.stringify({ regions: [{ ...region, x: 950 }] }), JSON.stringify({ regions: [{ ...region, text: null }] })]) {
    assert.throws(() => parseRegions(text), /Malformed/);
  }
  assert.equal(parseRegions(JSON.stringify({ regions: [{ ...region, background: "url(secret)" }] }))[0].background, "#ffffff");
});
test("tile overlaps deduplicate repeated regions while preserving other dialogue", () => {
  const first = { ...region, x: 0, y: 1300, width: 200, height: 100 };
  const merged = MangaRender.merge([first], [{ ...first, y: 1310 }, { ...first, y: 1500 }]);
  assert.equal(merged.length, 2);
});
test("OCR accepts numeric strings and omitted source text", () => {
  const result = parseRegions(JSON.stringify({ regions: [{ x: "50", y: "100", width: "200", height: "150", translation: " Hola " }] }));
  assert.deepEqual(result, [{ ...region, source: "" }]);
});
test("OCR normalizes fractions, explicit percentages and named box formats", () => {
  const fractional = { x: 0.05, y: 0.1, width: 0.2, height: 0.15, text: "Hola", source: "hello" };
  assert.deepEqual(parseRegions(JSON.stringify({ regions: [fractional] })), [region]);
  assert.deepEqual(parseRegions(JSON.stringify({ coordinate_system: "percent", regions: [{ ...region, x: 5, y: 10, width: 20, height: 15 }] })), [region]);
  assert.deepEqual(parseRegions(JSON.stringify({ regions: [{ text: "Hola", source: "hello", box_2d: [100, 50, 250, 250] }] })), [region]);
  assert.deepEqual(parseRegions(JSON.stringify({ regions: [{ text: "Hola", source: "hello", bbox: { x: 50, y: 100, width: 200, height: 150 } }] })), [region]);
  // Explicit 0–1000 metadata prevents scaling genuinely tiny boxes.
  const tiny = parseRegions(JSON.stringify({ coordinate_system: "normalized_1000", regions: [fractional] }))[0];
  assert.equal(tiny.x, 0.05);
});
test("OCR clips small edge errors but rejects unusable geometry with a specific reason", () => {
  const clipped = parseRegions(JSON.stringify({ regions: [{ ...region, x: -5, y: 900, width: 200, height: 110 }] }))[0];
  assert.deepEqual([clipped.x, clipped.y, clipped.width, clipped.height], [0, 900, 195, 100]);
  for (const value of [null, "", true, "50px"]) {
    assert.throws(() => parseRegions(JSON.stringify({ regions: [{ ...region, x: value }] })), /region 1 is missing numeric/);
  }
  assert.throws(() => parseRegions(JSON.stringify({ regions: [{ ...region, x: 1200 }] })), /outside the image/);
  assert.throws(() => parseRegions(JSON.stringify({ coordinate_system: "pixels", regions: [region] })), /not pixels/);
  assert.throws(() => parseRegions(JSON.stringify({ regions: [{ ...region, width: 0 }] })), /empty or reversed/);
});
test("renderer wraps CJK, positions text, fills only when requested", () => {
  const calls = [];
  const ctx = { measureText: s => ({ width: Array.from(s).length*10 }), clearRect() {}, save() {}, restore() {},
    beginPath() {}, rect() {}, clip() {}, fillRect: (...a) => calls.push(["fill", ...a]), fillText: (...a) => calls.push(["text", ...a]) };
  assert.deepEqual(MangaRender.wrap(ctx, "日本語翻訳", 20), ["日本", "語翻", "訳"]);
  MangaRender.draw(ctx, [region], 500, 500, config);
  assert.equal(calls[0][0], "fill"); assert.equal(calls[1][2], region.x+region.width/2);
  calls.length = 0;
  MangaRender.draw(ctx, [region], 500, 500, { ...config, cleanup: false });
  assert.ok(calls.every(c => c[0] !== "fill"));
});
