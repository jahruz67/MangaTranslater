import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULTS } from "../scripts/config.js";
import { TranslationCache, translationKey } from "../scripts/translation-cache.js";

const config = { ...DEFAULTS, apiKey: "private-key", model: "vision" };
const image = "data:image/jpeg;base64,YQ==";
const region = { x: 50, y: 100, width: 200, height: 150, text: "Hello", source: "", background: "#ffffff" };
function storage() {
  const data = {};
  return { data, async get(key) { return structuredClone({ [key]: data[key] }); },
    async set(value) { Object.assign(data, structuredClone(value)); }, async remove(key) { delete data[key]; } };
}

test("cache keys track images and translation settings while ignoring rendering and timeout", async () => {
  const key = await translationKey(config, image);
  assert.match(key, /^[0-9a-f]{64}$/);
  for (const change of [{ provider: "gemini" }, { endpoint: "https://other.example/v1" }, { model: "other" },
    { apiKey: "other" }, { source: "Japanese" }, { target: "Spanish" }, { quality: "literal" },
    { instructions: "Keep names" }, { detectSfx: true }, { includeSource: true }]) {
    assert.notEqual(await translationKey({ ...config, ...change }, image), key);
  }
  assert.notEqual(await translationKey(config, "data:image/jpeg;base64,Yg=="), key);
  assert.equal(await translationKey({ ...config, font: "WildWords", fontScale: 2, cleanup: false, requestTimeout: 60 }, image), key);
});

test("saved results survive worker restarts, isolate edits, and contain no images or keys", async () => {
  const saved = storage(), cache = new TranslationCache(saved);
  const key = await translationKey(config, image);
  await cache.put(key, [region]);
  const read = await cache.get(key);
  read[0].text = "Edited";
  assert.deepEqual(await new TranslationCache(saved).get(key), [region]);
  assert.deepEqual(await cache.get(key), [region]);
  await cache.put("e".repeat(64), []);
  assert.deepEqual(await new TranslationCache(saved).get("e".repeat(64)), []);
  const serialized = JSON.stringify(saved.data);
  assert.ok(!serialized.includes(config.apiKey));
  assert.ok(!serialized.includes(image));
  await cache.clear();
  assert.equal(await cache.get(key), undefined);
  assert.equal(await new TranslationCache(saved).get(key), undefined);
});

test("cache bounds evict the least recently used tile", async () => {
  const saved = storage(), cache = new TranslationCache(saved);
  const key = n => n.toString(16).padStart(64, "0");
  for (let i = 0; i < 128; i++) await cache.put(key(i), [region]);
  await cache.get(key(0));
  await cache.put(key(128), [region]);
  assert.equal(await cache.get(key(1)), undefined);
  assert.deepEqual(await cache.get(key(0)), [region]);
  assert.deepEqual(await new TranslationCache(saved).get(key(128)), [region]);
  // Large entries also respect the byte budget, independently of the entry limit.
  const large = Array.from({ length: 100 }, () => ({ ...region, text: "字".repeat(4900) }));
  await cache.put(key(129), large);
  await cache.put(key(130), large);
  assert.equal(await cache.get(key(129)), undefined);
  assert.ok(new TextEncoder().encode(JSON.stringify(saved.data.translationCache)).length <= 2 * 1024 * 1024);
});

test("clearing discards results from requests started before the clear", async () => {
  const saved = storage(), cache = new TranslationCache(saved);
  const generation = cache.generation;
  await cache.clear();
  await cache.put("a".repeat(64), [region], generation);
  assert.equal(await cache.get("a".repeat(64)), undefined);
  assert.equal(saved.data.translationCache, undefined);
});

test("unavailable storage and malformed saved entries do not block translation", async () => {
  const unavailable = new TranslationCache({ async get() { throw new Error("unavailable"); },
    async set() { throw new Error("quota"); } });
  await unavailable.put("a".repeat(64), [region]);
  assert.deepEqual(await unavailable.get("a".repeat(64)), [region]);
  const saved = storage();
  saved.data.translationCache = { version: 1, entries: [null, ["bad-key", []], ["b".repeat(64), [{}]], ["c".repeat(64), [region]]] };
  assert.deepEqual(await new TranslationCache(saved).get("c".repeat(64)), [region]);
});
