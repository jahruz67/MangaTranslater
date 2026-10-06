const form = document.querySelector("form"), status = document.querySelector("#status");
let saved;
async function request(type, extra = {}) {
  const r = await chrome.runtime.sendMessage({ type, ...extra });
  if (!r?.ok) throw new Error(r?.error || "Extension is unavailable. Reload it.");
  return r.value;
}
function fields() {
  return Object.fromEntries([...form.elements].filter(e => e.name).map(e => [e.name, e.type === "checkbox" ? e.checked : e.value]));
}
function updateProvider() {
  document.querySelector("#endpoint-label").hidden = form.elements.provider.value !== "compatible";
}
async function action(job) {
  const buttons = [...document.querySelectorAll("button")];
  buttons.forEach(b => b.disabled = true);
  status.textContent = "Working…";
  try { await job(); } catch (e) { status.textContent = e.message; }
  finally { buttons.forEach(b => b.disabled = false); }
}
await action(async () => {
  saved = await request("get-config");
  for (const [key, value] of Object.entries(saved)) {
    const e = form.elements.namedItem(key);
    if (e) { if (e.type === "checkbox") e.checked = value; else e.value = value; }
  }
  updateProvider(); status.textContent = "";
});
form.elements.provider.addEventListener("change", () => {
  form.elements.apiKey.value = ""; form.elements.model.value = "";
  updateProvider(); status.textContent = "Enter the key and model for this provider, then save.";
});
form.elements.endpoint.addEventListener("change", () => {
  if (saved && form.elements.endpoint.value !== saved.endpoint) {
    form.elements.apiKey.value = ""; status.textContent = "Endpoint changed. Re-enter its API key before saving.";
  }
});
async function save() { saved = fields(); await request("save-config", { config: saved }); }
form.addEventListener("submit", e => { e.preventDefault(); action(async () => { await save(); status.textContent = "Settings saved locally."; }); });
document.querySelector("#test").onclick = () => action(async () => {
  if (!form.reportValidity()) { status.textContent = "Check the highlighted settings."; return; }
  await save(); status.textContent = await request("test");
});
document.querySelector("#delete").onclick = () => action(async () => {
  await request("delete-key"); form.elements.apiKey.value = ""; status.textContent = "API key deleted.";
});
