export const DEFAULTS = Object.freeze({
  provider: "compatible", endpoint: "https://api.openai.com/v1", apiKey: "", model: "",
  source: "Auto", target: "English", quality: "natural", instructions: "",
  detectSfx: false, cleanup: true, font: "NotoSans", fontScale: 1,
  tileSize: 1400, minImageSize: 180, requestTimeout: 0
});
export function normalize(input = {}) {
  const c = {};
  for (const key of Object.keys(DEFAULTS)) c[key] = input[key] ?? DEFAULTS[key];
  if (!["compatible", "gemini", "anthropic"].includes(c.provider)) throw new Error("Unknown API provider.");
  for (const key of ["endpoint", "apiKey", "model", "source", "target", "instructions"]) {
    if (typeof c[key] !== "string") throw new Error(`Invalid ${key}.`);
    c[key] = c[key].trim();
  }
  const url = new URL(c.endpoint);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) {
    throw new Error("Use HTTPS, or HTTP on localhost.");
  }
  if (url.username || url.password || url.search || url.hash) throw new Error("Use a base endpoint without credentials, query, or fragment.");
  c.endpoint = url.href.replace(/\/$/, "");
  c.font = c.font === "WildWords" ? "WildWords" : "NotoSans";
  c.quality = c.quality === "literal" ? "literal" : "natural";
  c.cleanup = c.cleanup === true;
  c.detectSfx = c.detectSfx === true;
  for (const [key, low, high] of [["tileSize", 600, 2000], ["minImageSize", 50, 1000], ["fontScale", 0.5, 2]]) {
    c[key] = Math.min(high, Math.max(low, Number(c[key]) || DEFAULTS[key]));
  }
  if (!c.target) throw new Error("Enter a target language.");
  const timeout = Number(c.requestTimeout);
  c.requestTimeout = Number.isFinite(timeout) && timeout > 0 ? Math.min(240, Math.max(30, timeout)) : 0;
  return c;
}
export function requestOptions(c) {
  const slow = /gemma-4-31b-it/i.test(c.model || "");
  const seconds = Number(c.requestTimeout);
  return {
    timeoutMs: (Number.isFinite(seconds) && seconds > 0 ? Math.min(240, Math.max(30, seconds)) : slow ? 240 : 90)*1000,
    tileSize: slow ? Math.min(c.tileSize || 1400, 1000) : c.tileSize,
    stream: slow && ["compatible", "gemini"].includes(c.provider)
  };
}
export function requireReady(c) {
  if (!c.apiKey) throw new Error("No API key configured. Open Settings and add your API key to start translating.");
  if (!c.model) throw new Error("Open Settings and enter a vision-capable model supported by your provider.");
}
export function publicConfig(c) {
  const { apiKey, endpoint, ...safe } = c;
  return { ...safe, configured: Boolean(apiKey && c.model) };
}
