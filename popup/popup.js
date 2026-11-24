const status = document.querySelector("#status");
const api = globalThis.browser || globalThis.chrome;
function showStatus(message, state = "ready") {
  status.textContent = message;
  status.closest(".status-card").dataset.state = state;
}
document.querySelector("#settings").onclick = () => api.runtime.openOptionsPage();
for (const [id, type] of [["pick", "pick-image"], ["page", "translate-page"], ["stop", "stop"], ["restore", "restore"]]) {
  document.getElementById(id).onclick = async () => {
    try {
      const [tab] = await api.tabs.query({ active: true, currentWindow: true });
      const r = await api.tabs.sendMessage(tab.id, { type });
      showStatus(r?.message || "Done.");
      if (type === "pick-image" || type === "translate-page") window.close();
    } catch { showStatus("Open a normal webpage and reload it after installing the extension.", "attention"); }
  };
}
api.runtime.sendMessage({ type: "public-config" }).then(r => {
  if (r?.ok && r.value.configured) showStatus(`Ready · ${r.value.target}`);
  else showStatus("Open Settings to add your API key and vision model.", "attention");
}).catch(() => showStatus("Extension unavailable. Reload it and try again.", "attention"));
