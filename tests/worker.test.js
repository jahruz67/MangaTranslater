import test from "node:test";
import assert from "node:assert/strict";
const data = {};
let access, messageListener, installed;
const origin = "chrome-extension://test/";
globalThis.chrome = {
  storage: { local: { setAccessLevel: async v => { access = v; }, get: async key => structuredClone({ [key]: data[key] }),
    set: async value => Object.assign(data, structuredClone(value)) } },
  runtime: { id: "test", getURL: p => origin+p, openOptionsPage: async () => {},
    onMessage: { addListener: fn => messageListener = fn }, onInstalled: { addListener: fn => installed = fn } },
  contextMenus: { removeAll: async () => {}, create() {}, onClicked: { addListener() {} } },
  commands: { onCommand: { addListener() {} } }, tabs: {}
};
const worker = await import("../scripts/background.js");
const settings = { id: "test", url: origin+"popup/settings.html" };
const content = { id: "test", url: "https://manga.example/chapter", tab: { id: 1 } };
test("Stop aborts only its tab, releases the request slot, and permits another request", async () => {
  await worker.handle({ type: "save-config", config: { apiKey: "test-key", model: "test-model" } }, settings);
  const originalFetch = globalThis.fetch;
  try {
    for (const type of ["analyze", "prepare"]) {
      let entered, observed;
      const started = new Promise(resolve => entered = resolve);
      globalThis.fetch = async (_url, options) => new Promise((_resolve, reject) => {
        observed = options.signal;
        observed.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
        entered();
      });
      const payload = type === "analyze" ? { image: "data:image/jpeg;base64,YQ==" } : { url: "https://manga.example/image.jpg" };
      const job = worker.handle({ type, ...payload }, content);
      const rejected = assert.rejects(job, /Request cancelled/);
      await started;
      await worker.handle({ type: "cancel" }, { ...content, tab: { id: 2 } });
      assert.equal(observed.aborted, false);
      await worker.handle({ type: "cancel" }, content);
      assert.equal(observed.aborted, true);
      await rejected;
      globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"regions":[]}' } }] }));
      assert.deepEqual(await worker.handle({ type: "analyze", image: "data:image/jpeg;base64,YQ==" }, content), []);
    }
  } finally { globalThis.fetch = originalFetch; delete data.config; }
});
test("Stop cancels a request still waiting for settings without dispatching a fetch", async () => {
  await worker.handle({ type: "save-config", config: { apiKey: "test-key", model: "test-model" } }, settings);
  const originalGet = chrome.storage.local.get, originalFetch = globalThis.fetch;
  let release, entered, fetched = false;
  const started = new Promise(resolve => entered = resolve);
  chrome.storage.local.get = async key => {
    entered(); await new Promise(resolve => release = resolve); return originalGet(key);
  };
  globalThis.fetch = async () => { fetched = true; throw new Error("Unexpected request"); };
  try {
    const job = worker.handle({ type: "analyze", image: "data:image/jpeg;base64,YQ==" }, content);
    const rejected = assert.rejects(job, /Request cancelled/);
    await started;
    await worker.handle({ type: "cancel" }, content);
    release(); await rejected;
    assert.equal(fetched, false);
  } finally { chrome.storage.local.get = originalGet; globalThis.fetch = originalFetch; delete data.config; }
});
test("worker install, persistence across reload, key deletion and message boundary", async () => {
  await installed();
  assert.equal(data.config.apiKey, ""); assert.equal(access.accessLevel, "TRUSTED_CONTEXTS");
  const config = { ...data.config, apiKey: "private-key", model: "vision-test", target: "French" };
  await worker.handle({ type: "save-config", config }, settings);
  const restarted = await import("../scripts/background.js?restart");
  assert.equal((await restarted.readConfig()).apiKey, "private-key");
  assert.equal((await restarted.readConfig()).target, "French");
  const safe = await worker.handle({ type: "public-config" }, content);
  assert.equal(safe.apiKey, undefined); assert.equal(safe.configured, true);
  for (const type of ["get-config", "save-config", "delete-key", "test"]) {
    await assert.rejects(worker.handle({ type, config }, content), /Open Settings/);
  }
  await assert.rejects(worker.handle({ type: "get-config" }, { id: "different" }), /Unknown message source/);
  await worker.handle({ type: "delete-key" }, settings);
  assert.equal((await restarted.readConfig()).apiKey, "");
  await assert.rejects(worker.handle({ type: "prepare", url: "https://example.com/image.png" }, content), /No API key/);
  await assert.rejects(worker.handle({ type: "analyze", image: "bad" }, content), /No API key/);
  assert.equal(typeof messageListener, "function");
});
test("connection test and image tiling/analysis use the saved configuration", async () => {
  await worker.handle({ type: "save-config", config: { ...data.config, apiKey: "private-key", model: "vision-test", tileSize: 1000 } }, settings);
  const previousFetch = globalThis.fetch;
  const calls = [];
  let closed = false;
  globalThis.createImageBitmap = async () => ({ width: 1000, height: 2500, close() { closed = true; } });
  globalThis.OffscreenCanvas = class {
    constructor(width, height) { this.width = width; this.height = height; }
    getContext() { return { fillRect() {}, drawImage() {} }; }
    async convertToBlob() { return new Blob(["image"], { type: "image/jpeg" }); }
  };
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url === "https://manga.example/image.jpg") return new Response("image");
    const body = JSON.parse(options.body);
    const value = typeof body.messages[0].content === "string" ? "OK" : '{"regions":[{"x":10,"y":10,"width":50,"height":50,"text":"Bonjour","source":"Hello"}]}';
    return new Response(JSON.stringify({ choices: [{ message: { content: value } }] }));
  };
  try {
    assert.match(await worker.handle({ type: "test" }, settings), /successful/);
    const prepared = await worker.handle({ type: "prepare", url: "https://manga.example/image.jpg" }, content);
    assert.deepEqual(prepared.tiles.map(t => [t.y, t.height]), [[0, 1000], [900, 1000], [1800, 700]]);
    assert.equal(closed, true);
    for (const tile of prepared.tiles) {
      const regions = await worker.handle({ type: "analyze", image: tile.image }, content);
      assert.equal(regions[0].text, "Bonjour");
    }
    assert.equal(calls.length, 5);
    assert.equal(calls[1].options.credentials, "omit");
    assert.equal(calls[1].options.headers, undefined);
    await assert.rejects(worker.handle({ type: "analyze", image: "bad" }, content), /Invalid image payload/);
    await assert.rejects(worker.handle({ type: "prepare", url: "file:///secret" }, content), /Unsupported image source/);
  } finally { globalThis.fetch = previousFetch; }
});
