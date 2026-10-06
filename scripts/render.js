(() => {
  function wrap(ctx, text, width) {
    const lines = [];
    for (const paragraph of text.split("\n")) {
      let line = "";
      for (const part of paragraph.split(/(\s+)/)) {
        if (ctx.measureText(line + part).width <= width) { line += part; continue; }
        if (line.trim()) lines.push(line.trim());
        line = "";
        // Character fallback for CJK and long words.
        for (const char of part.trim()) {
          if (line && ctx.measureText(line + char).width > width) { lines.push(line); line = ""; }
          line += char;
        }
      }
      lines.push(line.trim());
    }
    return lines;
  }
  function draw(ctx, regions, width, height, config) {
    ctx.clearRect(0, 0, width, height);
    let clipped = 0;
    for (const r of regions) {
      const pad = Math.min(4, r.width / 10, r.height / 10);
      const innerW = Math.max(1, r.width-2*pad), innerH = Math.max(1, r.height-2*pad);
      ctx.save(); ctx.beginPath(); ctx.rect(r.x, r.y, r.width, r.height); ctx.clip();
      if (config.cleanup) { ctx.fillStyle = r.background; ctx.fillRect(r.x, r.y, r.width, r.height); }
      let size = Math.min(60, r.height * 0.6) * config.fontScale, lines;
      do {
        ctx.font = `${size}px "Manga${config.font}", sans-serif`;
        lines = wrap(ctx, r.text, innerW);
        if (lines.length * size * 1.15 <= innerH || size <= 3) break;
        size -= 0.5;
      } while (true);
      if (lines.length * size * 1.15 > innerH) clipped++;
      const rgb = r.background.match(/[0-9a-f]{2}/gi).map(v => parseInt(v, 16));
      ctx.fillStyle = config.cleanup && rgb[0]*0.299+rgb[1]*0.587+rgb[2]*0.114 < 128 ? "#ffffff" : "#111111";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.direction = /[\u0590-\u08ff]/.test(r.text) ? "rtl" : "ltr";
      const y = r.y + r.height/2 - (lines.length-1)*size*1.15/2;
      lines.forEach((line, i) => ctx.fillText(line, r.x+r.width/2, y+i*size*1.15, innerW));
      ctx.restore();
    }
    return clipped;
  }
  function merge(regions, incoming) {
    for (const r of incoming) {
      const duplicate = regions.some(a => {
        const intersection = Math.max(0, Math.min(a.x+a.width, r.x+r.width)-Math.max(a.x, r.x)) *
          Math.max(0, Math.min(a.y+a.height, r.y+r.height)-Math.max(a.y, r.y));
        return intersection / Math.min(a.width*a.height, r.width*r.height) > 0.5;
      });
      if (!duplicate) regions.push(r);
    }
    return regions;
  }
  globalThis.MangaRender = { wrap, draw, merge };
})();
