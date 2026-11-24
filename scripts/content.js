(() => {
  const api = globalThis.browser || globalThis.chrome;
  const host = document.createElement("div");
  host.style.cssText = "all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;";
  const root = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = `
    :host{font:14px system-ui}*{box-sizing:border-box}[hidden]{display:none!important}
    button{font:14px system-ui;border:0;border-radius:6px;background:#6750ce;color:white;padding:10px;min-width:44px;min-height:44px;cursor:pointer;touch-action:manipulation}
    button:disabled{opacity:.5}button:focus-visible{outline:2px solid #c9c2ff;outline-offset:2px}
    #bar{position:fixed;display:none;flex-wrap:wrap;gap:4px;pointer-events:auto;background:#1e1d2a;padding:4px;border-radius:8px}#bar button{flex:1 1 auto;overflow-wrap:anywhere}
    #notice{position:fixed;bottom:calc(16px + env(safe-area-inset-bottom,0px));right:12px;max-width:min(440px,calc(100vw - 24px));max-height:50vh;overflow:auto;background:#222;color:white;border-radius:8px;padding:12px;white-space:pre-wrap;overflow-wrap:anywhere;pointer-events:auto;display:none}
    img.overlay{position:fixed;pointer-events:none;margin:0;padding:0;border:0}
    dialog{pointer-events:auto;color:#eee;background:#242332;border:1px solid #777;border-radius:12px;width:min(700px,calc(100% - 16px));max-height:80vh;max-height:80dvh;overflow:auto;overscroll-behavior:contain;font:16px system-ui;padding:16px}
    textarea{width:100%;min-height:80px;font:16px system-ui}input{width:90px;min-height:44px;font:16px system-ui}label{display:inline-block;margin:5px}fieldset{margin:12px 0;min-width:0}small{display:block;color:#bbb;overflow-wrap:anywhere}
    @media(hover:none) and (pointer:coarse){#bar{padding-bottom:calc(4px + env(safe-area-inset-bottom,0px))}#notice{bottom:auto;top:calc(12px + env(safe-area-inset-top,0px))}}
    @media(max-width:480px){fieldset label{width:calc(50% - 12px)}fieldset input{display:block;width:100%}}
  `;
  root.append(style);
  const bar = document.createElement("div"); bar.id = "bar";
  bar.setAttribute("role", "toolbar"); bar.setAttribute("aria-label", "Manga image controls");
  const notice = document.createElement("div"); notice.id = "notice"; notice.setAttribute("role", "status");
  const message = document.createElement("span"), settings = document.createElement("button"); settings.textContent = "Settings";
  settings.onclick = () => request("open-settings").catch(e => show(e.message));
  const cancelButton = document.createElement("button");
  cancelButton.textContent = "Stop"; cancelButton.title = "Cancel the current request and remaining images";
  cancelButton.style.marginLeft = "6px"; cancelButton.disabled = true;
  cancelButton.onclick = () => cancelTranslation().catch(e => show(e.message));
  notice.append(message, document.createElement("br"), settings, cancelButton);
  root.append(bar, notice); document.documentElement.append(host);
  const records = new Map();
  let selected, picking = false, busy = false, stop = false, epoch = 0, minSize = 180, noticeTimer, frame;
  async function request(type, extra = {}) {
    const r = await api.runtime.sendMessage({ type, ...extra });
    if (!r?.ok) throw new Error(r?.error || "Extension unavailable. Reload this page.");
    return r.value;
  }
  function show(text) {
    clearTimeout(noticeTimer); message.textContent = text; notice.style.display = "block";
    if (!busy && !picking) noticeTimer = setTimeout(() => notice.style.display = "none", 15000);
  }
  async function cancelTranslation() {
    epoch++; stop = true; picking = false; cancelButton.disabled = true;
    show("Stopping…");
    await request("cancel");
    show("Stopped. Current request cancelled.");
  }
  const actions = {};
  for (const [key, title, handler] of [
    ["translate", "Translate", () => run([selected])],
    ["original", "Original", () => restore(selected)],
    ["edit", "Edit", () => edit(selected)],
    ["download", "Save PNG", () => download(selected).catch(e => show(e.message))],
    ["close", "Close", () => select(null)]
  ]) {
    const b = document.createElement("button"); b.textContent = title; b.onclick = handler; bar.append(b); actions[key] = b;
  }
  function source(el) { return el instanceof HTMLImageElement ? el.currentSrc || el.src : "canvas"; }
  function imageSource(el) {
    return { source: source(el), src: el.src, srcset: el.srcset,
      aspect: (el.naturalWidth ?? el.width)/(el.naturalHeight ?? el.height),
      responsive: el instanceof HTMLImageElement && Boolean(el.srcset) && !el.closest("picture") };
  }
  function sameSource(el, image) {
    if (source(el) === image.source) return true;
    // A density/resolution change in one srcset keeps the same artwork and geometry.
    // Picture art direction or a changed src/srcset still requires a new translation.
    return image.responsive && el instanceof HTMLImageElement && el.src === image.src &&
      el.srcset === image.srcset && (!el.complete || Math.abs((el.naturalWidth/el.naturalHeight)/image.aspect-1) < 0.01);
  }
  function candidate(el) {
    if (!(el instanceof HTMLImageElement || el instanceof HTMLCanvasElement)) return false;
    const w = el.naturalWidth ?? el.width, h = el.naturalHeight ?? el.height;
    return w >= minSize && h >= minSize && el.getBoundingClientRect().width > 0;
  }
  function restore(el) {
    const r = records.get(el);
    if (r) { r.overlay.remove(); records.delete(el); if (el !== selected) resizeObserver.unobserve(el); scheduleLayout(); }
  }
  function select(el) {
    if (selected && !records.has(selected)) resizeObserver.unobserve(selected);
    selected = el;
    if (el) resizeObserver.observe(el); else bar.style.display = "none";
    scheduleLayout();
  }
  function scheduleLayout() {
    if (frame === undefined && !document.hidden && (records.size || selected)) frame = requestAnimationFrame(layout);
  }
  function layout() {
    frame = undefined;
    const viewport = window.visualViewport;
    const left = viewport?.offsetLeft || 0, top = viewport?.offsetTop || 0;
    const width = viewport?.width || innerWidth, height = viewport?.height || innerHeight;
    for (const [el, r] of records) {
      if (!el.isConnected) { restore(el); continue; }
      if (el instanceof HTMLImageElement && (!el.complete || !el.naturalWidth)) { r.overlay.style.display = "none"; continue; }
      if (!sameSource(el, r)) { restore(el); continue; }
      const box = el.getBoundingClientRect();
      if (!box.width || !box.height || box.bottom <= top || box.top >= top+height || box.right <= left || box.left >= left+width) {
        r.overlay.style.display = "none"; continue;
      }
      const css = getComputedStyle(el);
      Object.assign(r.overlay.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px`,
        objectFit: css.objectFit, objectPosition: css.objectPosition, borderRadius: css.borderRadius,
        visibility: css.visibility, opacity: css.opacity, display: box.width && box.height ? "block" : "none" });
    }
    if (selected && !selected.isConnected) { resizeObserver.unobserve(selected); selected = null; }
    if (selected) {
      const box = selected.getBoundingClientRect();
      for (const key of ["original", "edit", "download"]) actions[key].hidden = !records.has(selected);
      actions.translate.disabled = busy;
      bar.style.display = box.width && box.height && box.bottom > top && box.top < top+height && box.right > left && box.left < left+width ? "flex" : "none";
      bar.style.maxWidth = `${Math.max(1, width-16)}px`;
      const controls = bar.getBoundingClientRect();
      const touch = matchMedia("(hover: none), (pointer: coarse)").matches;
      bar.style.left = `${Math.max(left+8, Math.min(left+width-controls.width-8, box.left))}px`;
      bar.style.top = `${Math.max(top+8, Math.min(top+height-controls.height-8, touch ? top+height : box.top))}px`;
    } else bar.style.display = "none";
  }
  const resizeObserver = new ResizeObserver(scheduleLayout);
  resizeObserver.observe(document.documentElement);
  if (document.body) resizeObserver.observe(document.body);
  new MutationObserver(scheduleLayout).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener("scroll", scheduleLayout, { capture: true, passive: true });
  document.addEventListener("load", scheduleLayout, true);
  document.addEventListener("error", scheduleLayout, true);
  document.addEventListener("visibilitychange", scheduleLayout);
  window.addEventListener("resize", scheduleLayout, { passive: true });
  window.visualViewport?.addEventListener("resize", scheduleLayout, { passive: true });
  window.visualViewport?.addEventListener("scroll", scheduleLayout, { passive: true });
  document.addEventListener("pointerover", e => { if (e.pointerType !== "touch" && candidate(e.target)) select(e.target); }, true);
  document.addEventListener("contextmenu", e => { if (candidate(e.target)) select(e.target); }, true);
  document.addEventListener("click", e => {
    if (!candidate(e.target) || !(picking || matchMedia("(hover: none), (pointer: coarse)").matches)) return;
    if (picking) {
      e.preventDefault(); e.stopImmediatePropagation(); picking = false; cancelButton.disabled = !busy;
      show("Image selected. Tap Translate below.");
    }
    select(e.target);
  }, true);
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") { picking = false; cancelButton.disabled = !busy; select(null); }
  });
  request("public-config").then(c => minSize = c.minImageSize).catch(() => {});
  async function imageURL(el, tileSize) {
    try {
      const width = el.naturalWidth ?? el.width, height = el.naturalHeight ?? el.height;
      const scale = Math.min(1, tileSize/width);
      const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(width*scale)); c.height = Math.max(1, Math.round(height*scale));
      if (c.height > 32760 || c.width*c.height > 32000000) throw new Error("large");
      const ctx = c.getContext("2d");
      ctx.fillStyle = "white"; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(el, 0, 0, c.width, c.height);
      return c.toDataURL("image/jpeg", 0.95);
    } catch {
      if (el instanceof HTMLImageElement && /^https?:/.test(source(el))) return source(el);
      throw new Error("Image-processing failure: canvas or image cannot be read on this website.");
    }
  }
  async function loadFont(c) {
    const file = c.font === "WildWords" ? "WildWords.otf" : "NotoSans.ttf";
    const family = `Manga${c.font}`;
    if (document.fonts.check(`12px "${family}"`)) {
      // FontFaceSet.check can also be true for a missing font; explicitly load our face once.
      if ([...document.fonts].some(f => f.family === family)) return;
    }
    try { const font = new FontFace(family, `url("${api.runtime.getURL(`fonts/${file}`)}")`); await font.load(); document.fonts.add(font); } catch {}
  }
  function render(r) {
    const canvas = document.createElement("canvas"); canvas.width = r.width; canvas.height = r.height;
    const clipped = MangaRender.draw(canvas.getContext("2d"), r.regions, r.width, r.height, r.config);
    r.canvas = canvas; r.overlay.src = canvas.toDataURL("image/png");
    if (clipped) show("Some text does not fit. Use Edit to shorten text or enlarge its region.");
  }
  async function translate(el, config, generation) {
    const original = imageSource(el);
    const url = await imageURL(el, config.effectiveTileSize || config.tileSize);
    if (generation !== epoch) return;
    const data = await request("prepare", { url });
    const regions = [];
    for (let i = 0; i < data.tiles.length; i++) {
      if (generation !== epoch) return;
      const tile = data.tiles[i]; show(`Translating image · tile ${i+1}/${data.tiles.length}`);
      const found = await request("analyze", { image: tile.image });
      MangaRender.merge(regions, found.map(r => ({ ...r, x: r.x*data.width/1000, y: tile.y+r.y*tile.height/1000,
        width: r.width*data.width/1000, height: r.height*tile.height/1000 })));
    }
    if (generation !== epoch || !el.isConnected || !sameSource(el, original)) return;
    if (!regions.length) { show("OCR found no text in this image."); return; }
    await loadFont(config);
    if (generation !== epoch || !sameSource(el, original)) return;
    restore(el);
    const overlay = document.createElement("img"); overlay.className = "overlay"; overlay.alt = "";
    const r = { ...data, ...original, regions, config, overlay };
    render(r); records.set(el, r); root.insertBefore(overlay, bar); resizeObserver.observe(el); scheduleLayout();
  }
  async function run(elements) {
    if (busy) { show("A translation is already running."); return; }
    busy = true; stop = false; picking = false; cancelButton.disabled = false; const generation = epoch;
    scheduleLayout();
    show("Preparing translation…");
    try {
      const config = await request("public-config"); minSize = config.minImageSize;
      if (generation !== epoch) return;
      if (!config.configured) throw new Error("No API key or vision model configured. Open Settings to start translating.");
      const targets = elements.filter(el => el && candidate(el));
      if (!targets.length) throw new Error("No loaded manga images found. Hover over an image, or scroll to load more pages.");
      let completed = 0;
      for (const el of targets) {
        if (stop || generation !== epoch) break;
        await translate(el, config, generation); completed++;
      }
      if (generation === epoch) show(`${stop ? "Stopped" : "Finished"}: processed ${completed}/${targets.length} images.`);
    } catch (e) { if (generation === epoch) show(e.message); }
    finally { busy = false; cancelButton.disabled = true; show(message.textContent); scheduleLayout(); }
  }
  function edit(el) {
    const r = records.get(el); if (!r) return;
    const dialog = document.createElement("dialog"), form = document.createElement("form");
    const title = document.createElement("h2"); title.textContent = "Edit text and position"; form.append(title);
    const inputs = r.regions.map((region, i) => {
      const group = document.createElement("fieldset"), legend = document.createElement("legend"); legend.textContent = `Region ${i+1}`;
      const source = document.createElement("small"); source.textContent = region.source;
      const text = document.createElement("textarea"); text.value = region.text; text.required = true;
      group.append(legend, source, text); const fields = {};
      for (const key of ["x", "y", "width", "height"]) {
        const label = document.createElement("label"), input = document.createElement("input");
        label.textContent = `${key} `; input.type = "number"; input.step = "any"; input.min = key === "x" || key === "y" ? "0" : "1";
        input.value = String(region[key]); input.required = true; label.append(input); group.append(label); fields[key] = input;
      }
      form.append(group); return { text, fields };
    });
    const save = document.createElement("button"); save.textContent = "Apply"; save.type = "submit";
    const cancel = document.createElement("button"); cancel.textContent = "Cancel"; cancel.type = "button";
    cancel.onclick = () => dialog.close(); form.append(save, cancel); dialog.append(form); root.append(dialog);
    dialog.onclose = () => dialog.remove();
    form.onsubmit = e => {
      e.preventDefault();
      const updated = inputs.map((input, i) => ({ ...r.regions[i], text: input.text.value,
        ...Object.fromEntries(Object.entries(input.fields).map(([k, v]) => [k, Number(v.value)])) }));
      if (updated.some(v => v.x+v.width > r.width || v.y+v.height > r.height)) { show("Keep regions within the image dimensions."); return; }
      r.regions = updated; render(r); dialog.close();
    };
    dialog.showModal();
  }
  async function download(el) {
    const r = records.get(el); if (!r) return;
    const canvas = document.createElement("canvas"); canvas.width = r.width; canvas.height = r.height;
    const ctx = canvas.getContext("2d");
    for (const tile of r.tiles) {
      const image = new Image(); image.src = tile.image; await image.decode(); ctx.drawImage(image, 0, tile.y);
    }
    ctx.drawImage(r.canvas, 0, 0);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("Image export failed.");
    const url = URL.createObjectURL(blob), a = document.createElement("a"); a.href = url; a.download = "manga-translated.png";
    root.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  api.runtime.onMessage.addListener((msg, sender, reply) => {
    if (sender.id !== api.runtime.id) return;
    if (msg.type === "pick-image") {
      if (busy) { show("Finish or stop the current translation before choosing another image."); reply({ message: "A translation is already running." }); return; }
      picking = true; cancelButton.disabled = false;
      show("Tap a manga image, then tap Translate. Use Stop to cancel selection.");
      reply({ message: "Tap an image on the page." });
    }
    else if (msg.type === "translate-page") { run([...document.querySelectorAll("img,canvas")]); reply({ message: "Page translation started. Progress appears on the page." }); }
    else if (msg.type === "translate-image") {
      const target = msg.url ? (source(selected || {}) === msg.url ? selected : [...document.images].find(el => source(el) === msg.url)) : selected;
      run([target]); reply({ message: "Translation started." });
    } else if (msg.type === "stop") {
      cancelTranslation().then(() => reply({ message: "Current request and remaining images cancelled." }), e => reply({ message: e.message }));
      return true;
    }
    else if (msg.type === "restore") {
      epoch++; stop = true; picking = false; cancelButton.disabled = !busy;
      for (const el of records.keys()) restore(el);
      show("Original images restored."); reply({ message: "Original images restored." });
    }
  });
})();
