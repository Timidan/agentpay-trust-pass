/** Small deterministic PRNG so a token's chart stays stable across renders. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Procedurally draws a believable token price chart on a canvas and returns a
 * data URL. Used as the "real asset" stand-in for VerdictReveal demos and the
 * landing hero — a data URL keeps it same-origin so the WebGL texture is never
 * tainted, and it works offline.
 *
 * Pass `seed` for a stable, repeatable chart (per token); omit it for a random one.
 */
export function drawTokenChart(seed?: number): string {
  const rnd = seed === undefined ? Math.random : mulberry32(seed);
  const w = 1280;
  const h = 800;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    // No 2D canvas (e.g. jsdom): hand back a valid 1x1 transparent PNG so the
    // image src is never empty.
    return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  }

  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, "#16242f");
  bg.addColorStop(1, "#0e1a24");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = "rgba(180,205,235,0.10)";
  ctx.lineWidth = 1;
  for (let i = 1; i < 8; i++) {
    const y = (h / 8) * i;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  const count = 64;
  const pad = 60;
  const cw = (w - pad * 2) / count;
  let price = h * 0.55;
  const closes: number[] = [];
  for (let i = 0; i < count; i++) {
    const open = price;
    const drift = (rnd() - 0.48) * 46;
    const close = Math.max(h * 0.2, Math.min(h * 0.82, open + drift));
    const high = Math.min(open, close) - rnd() * 22;
    const low = Math.max(open, close) + rnd() * 22;
    const x = pad + i * cw + cw / 2;
    const up = close < open;
    ctx.strokeStyle = up ? "rgba(70,210,150,0.9)" : "rgba(235,90,110,0.9)";
    ctx.fillStyle = up ? "rgba(70,210,150,0.85)" : "rgba(235,90,110,0.85)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, high);
    ctx.lineTo(x, low);
    ctx.stroke();
    const bodyW = Math.max(2, cw * 0.6);
    ctx.fillRect(x - bodyW / 2, Math.min(open, close), bodyW, Math.max(2, Math.abs(close - open)));
    price = close;
    closes.push(close);
  }

  ctx.strokeStyle = "rgba(150,180,255,0.7)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  closes.forEach((c, i) => {
    const window = closes.slice(Math.max(0, i - 6), i + 1);
    const avg = window.reduce((a, b) => a + b, 0) / window.length;
    const x = pad + i * cw + cw / 2;
    if (i === 0) {
      ctx.moveTo(x, avg);
    } else {
      ctx.lineTo(x, avg);
    }
  });
  ctx.stroke();

  ctx.fillStyle = "rgba(200,220,245,0.85)";
  ctx.font = "600 26px monospace";
  ctx.fillText("$CASPR / USD", pad, 52);
  ctx.font = "400 18px monospace";
  ctx.fillStyle = "rgba(160,185,215,0.7)";
  ctx.fillText("1h · live on-chain", pad, 78);

  return canvas.toDataURL("image/png");
}
