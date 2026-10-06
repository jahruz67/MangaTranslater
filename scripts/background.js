import { DEFAULTS, normalize, requireReady, publicConfig, requestOptions } from "./config.js";
import { analyze, callProvider } from "./providers.js";
import { withDeadline } from "./requests.js";

const api = chrome;
// Content scripts get only the explicit public projection through messages.
const ready = api.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
const settingsURLs = [api.runtime.getURL("popup/settings.html"), api.runtime.getURL("popup/popup.html")];
export async function readConfig() {
  await ready;
  return normalize((await api.storage.local.get("config")).config || DEFAULTS);
}
const active = new Map();
const generations = new Map();
async function serialize(sender, generation, job) {
  const id = sender.tab?.id ?? "settings";
  if (generation !== (generations.get(id) || 0)) throw new Error("Request cancelled.");
  if (active.has(id)) throw new Error("A request is already running. Wait for it to finish.");
  const controller = new AbortController();
  active.set(id, controller);
  // Extension API activity prevents idle shutdown while a streamed model thinks.
  // Bounded to the running request; always removed on success, failure or Stop.
  const keepAlive = setInterval(() => { api.runtime.getPlatformInfo?.().catch(() => {}); }, 20000);
  try { return await job(controller.signal); } finally { clearInterval(keepAlive); active.delete(id); }
}
async function dataURL(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let text = "";
  for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i+8192));
  return `data:${blob.type};base64,${btoa(text)}`;
}
async function prepareImage(url, size, signal) {
  return withDeadline(signal, 20000, async requestSignal => {
  if (typeof url !== "string" || url.length > 24000000 || !/^(https?:\/\/|data:image\/(png|jpeg|webp);base64,)/i.test(url)) {
    throw new Error("Unsupported image source. Use a loaded image or canvas.");
  }
  let bitmap;
  try {
    const response = await fetch(url, { credentials: "omit", signal: requestSignal });
    if (!response.ok) throw new Error("Image server denied the request.");
    if (Number(response.headers.get("content-length")) > 16000000) throw new Error("Image exceeds 16 MB.");
    const blob = await response.blob();
    if (blob.size > 16000000) throw new Error("Image exceeds 16 MB.");
    bitmap = await createImageBitmap(blob);
    requestSignal.throwIfAborted();
    const width = Math.min(bitmap.width, size);
    const height = Math.round(bitmap.height * width / bitmap.width);
    if (!width || !height || height > 32760 || width * height > 32000000) throw new Error("Image is too tall. Split it into smaller pages.");
    const tiles = [];
    const step = size - 100;
    for (let y = 0; y < height; y += step) {
      requestSignal.throwIfAborted();
      const h = Math.min(size, height-y);
      const canvas = new OffscreenCanvas(width, h);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "white"; ctx.fillRect(0, 0, width, h);
      ctx.drawImage(bitmap, 0, -y, width, height);
      tiles.push({ y, height: h, image: await dataURL(await canvas.convertToBlob({ type: "image/jpeg", quality: 0.9 })) });
      if (y+h >= height) break;
    }
    return { width, height, tiles };
  } catch (e) { throw new Error(`Image-processing failure: ${e.message}`); }
  finally { bitmap?.close(); }
  });
}
export async function handle(msg, sender) {
  if (sender.id !== api.runtime.id) throw new Error("Unknown message source.");
  const trusted = settingsURLs.includes(sender.url);
  if (!msg || typeof msg.type !== "string") throw new Error("Invalid request.");
  const id = sender.tab?.id ?? "settings";
  // Cancel before reading settings: even a stalled settings read must not block Stop.
  if (msg.type === "cancel") {
    if (!sender.tab && !trusted) throw new Error("Unknown cancellation source.");
    generations.set(id, (generations.get(id) || 0)+1);
    active.get(id)?.abort();
    return true;
  }
  const generation = generations.get(id) || 0;
  const c = await readConfig();
  switch (msg.type) {
    case "public-config": return publicConfig(c);
    case "get-config":
      if (!trusted) throw new Error("Open Settings to access API configuration.");
      return c;
    case "save-config":
      if (!trusted) throw new Error("Open Settings to change API configuration.");
      await api.storage.local.set({ config: normalize(msg.config) });
      return true;
    case "delete-key":
      if (!trusted) throw new Error("Open Settings to remove the API key.");
      await api.storage.local.set({ config: { ...c, apiKey: "" } });
      return true;
    case "open-settings": await api.runtime.openOptionsPage(); return true;
    case "test":
      if (!trusted) throw new Error("Open Settings to test the API.");
      requireReady(c);
      return serialize(sender, generation, async signal => {
        await callProvider(c, "Reply with OK.", undefined, undefined, signal);
        return "Connection successful. Image support is checked when translating.";
      });
    case "prepare":
      requireReady(c);
      return serialize(sender, generation, signal => prepareImage(msg.url, requestOptions(c).tileSize, signal));
    case "analyze":
      requireReady(c);
      if (typeof msg.image !== "string" || !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(msg.image) || msg.image.length > 12000000) throw new Error("Invalid image payload.");
      return serialize(sender, generation, signal => analyze(c, msg.image, undefined, signal));
    default: throw new Error("Unknown request.");
  }
}
api.runtime.onMessage.addListener((msg, sender, reply) => {
  handle(msg, sender).then(value => reply({ ok: true, value }), e => reply({ ok: false, error: e.message }));
  return true;
});
api.tabs.onRemoved?.addListener(id => {
  active.get(id)?.abort();
  // Retain the cancelled generation until pending reads settle, then discard it.
  generations.set(id, (generations.get(id) || 0)+1);
  setTimeout(() => generations.delete(id), 120000);
});
api.runtime.onInstalled.addListener(async () => {
  await ready;
  if (!(await api.storage.local.get("config")).config) await api.storage.local.set({ config: DEFAULTS });
  await api.contextMenus.removeAll();
  api.contextMenus.create({ id: "translate-image", title: "Translate manga image", contexts: ["image"] });
});
async function sendTab(tabId, message) {
  if (!Number.isInteger(tabId)) return;
  try { await api.tabs.sendMessage(tabId, message, { frameId: 0 }); } catch {}
}
api.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "translate-image") sendTab(tab?.id, { type: "translate-image", url: info.srcUrl });
});
api.commands.onCommand.addListener(async name => {
  if (name === "translate-image") {
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    await sendTab(tab?.id, { type: name });
  }
});
