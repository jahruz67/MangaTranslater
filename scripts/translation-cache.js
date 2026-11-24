import { buildOcrPrompt, parseRegions } from "./providers.js";

const STORAGE_KEY = "translationCache";
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_ENTRIES = 128;

export async function translationKey(c, image) {
  // Hash pixels and every API/output-affecting setting; never persist images or keys.
  const input = JSON.stringify([c.provider, c.endpoint, c.model, c.apiKey, buildOcrPrompt(c), image]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}

export class TranslationCache {
  constructor(storage) {
    this.storage = storage;
    this.entries = new Map();
    this.bytes = 0;
    this.loaded = undefined;
    this.pending = Promise.resolve();
    this.generation = 0;
  }
  async load() {
    if (!this.loaded) this.loaded = this.storage.get(STORAGE_KEY).then(data => {
      const saved = data[STORAGE_KEY];
      if (saved?.version !== 1 || !Array.isArray(saved.entries)) return;
      for (const entry of saved.entries.slice(-MAX_ENTRIES)) {
        if (!Array.isArray(entry) || !/^[0-9a-f]{64}$/.test(entry[0])) continue;
        try {
          this.remember(entry[0], parseRegions(JSON.stringify({ coordinate_system: "normalized_1000", regions: entry[1] })));
        } catch { /* Ignore damaged cache entries. */ }
      }
    }).catch(() => {}); // Cache availability must never prevent translation.
    await this.loaded;
  }
  remember(key, regions) {
    const bytes = new TextEncoder().encode(JSON.stringify([key, regions])).length + 1;
    if (bytes > MAX_BYTES - 100) return;
    const previous = this.entries.get(key);
    if (previous) this.bytes -= previous.bytes;
    this.entries.delete(key);
    this.entries.set(key, { regions: structuredClone(regions), bytes });
    this.bytes += bytes;
    while (this.entries.size > MAX_ENTRIES || this.bytes > MAX_BYTES - 100) {
      const oldest = this.entries.keys().next().value;
      this.bytes -= this.entries.get(oldest).bytes;
      this.entries.delete(oldest);
    }
  }
  async get(key) {
    await this.load();
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return structuredClone(entry.regions);
  }
  async put(key, regions, generation = this.generation) {
    await this.load();
    if (generation !== this.generation) return;
    this.remember(key, regions);
    // Serialize writes from different tabs so an older snapshot cannot overwrite a newer one.
    this.pending = this.pending.catch(() => {}).then(() => this.storage.set({ [STORAGE_KEY]: {
      version: 1, entries: Array.from(this.entries, ([id, value]) => [id, value.regions])
    } })).catch(() => {});
    await this.pending;
  }
  async clear() {
    this.generation++;
    await this.load();
    this.entries.clear(); this.bytes = 0;
    this.pending = this.pending.catch(() => {}).then(() => this.storage.remove(STORAGE_KEY));
    await this.pending;
  }
}
