const status = document.querySelector("#status");
function showStatus(message, state = "ready") {
  status.textContent = message;
  status.closest(".status-card").dataset.state = state;
}
document.querySelector("#settings").onclick = () => chrome.runtime.openOptionsPage();
for (const [id, type] of [["page", "translate-page"], ["stop", "stop"], ["restore", "restore"]]) {
  document.getElementById(id).onclick = async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const r = await chrome.tabs.sendMessage(tab.id, { type });
      showStatus(r?.message || "Done.");
    } catch { showStatus("Open a normal webpage and reload it after installing the extension.", "attention"); }
  };
}
chrome.runtime.sendMessage({ type: "public-config" }).then(r => {
  if (r?.ok && r.value.configured) showStatus(`Ready · ${r.value.target}`);
  else showStatus("Open Settings to add your API key and vision model.", "attention");
}).catch(() => showStatus("Extension unavailable. Reload it and try again.", "attention"));
