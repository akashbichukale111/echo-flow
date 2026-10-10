import * as THREE from "three";

export function rng(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return [c, c.getContext("2d") as CanvasRenderingContext2D] as const;
}
function finish(c: HTMLCanvasElement, srgb: boolean, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** Asphalt tile: 8.4 m wide x 14 m long, with edge lines and a mint-tinted mobility lane. */
export function roadTexture() {
  const [c, g] = canvas(512, 1024);
  const r = rng(11);
  g.fillStyle = "#2b3033"; g.fillRect(0, 0, 512, 1024);
  for (let i = 0; i < 9000; i++) {
    const v = 36 + r() * 30;
    g.fillStyle = `rgba(${v},${v + 3},${v + 5},${0.25 + r() * 0.4})`;
    g.fillRect(r() * 512, r() * 1024, 1 + r() * 2, 1 + r() * 2);
  }
  const px = (m: number) => ((m + 4.2) / 8.4) * 512;
  const lane = g.createLinearGradient(px(-1.6), 0, px(1.6), 0);
  lane.addColorStop(0, "rgba(70,190,150,0)"); lane.addColorStop(0.15, "rgba(70,190,150,.2)");
  lane.addColorStop(0.85, "rgba(70,190,150,.2)"); lane.addColorStop(1, "rgba(70,190,150,0)");
  g.fillStyle = lane; g.fillRect(px(-1.6), 0, px(1.6) - px(-1.6), 1024);
  g.fillStyle = "rgba(236,238,228,.88)";
  g.fillRect(px(-3.95), 0, 7, 1024); g.fillRect(px(3.95) - 7, 0, 7, 1024);
  g.fillStyle = "rgba(236,238,228,.55)";
  for (let i = 0; i < 6; i++) {
    g.fillRect(px(-1.62), i * 170 + 10, 5, 80); g.fillRect(px(1.62) - 5, i * 170 + 10, 5, 80);
  }
  g.fillStyle = "rgba(160,235,205,.32)";
  for (let i = 0; i < 2; i++) {
    const y = 300 + i * 512;
    g.beginPath(); g.moveTo(px(-0.5), y + 40); g.lineTo(px(0), y); g.lineTo(px(0.5), y + 40);
    g.lineTo(px(0.5), y + 62); g.lineTo(px(0), y + 22); g.lineTo(px(-0.5), y + 62); g.fill();
  }
  const t = finish(c, true);
  t.repeat.set(1, 1);
  return t;
}

/** Lawn tile (6 m). */
export function grassTexture() {
  const [c, g] = canvas(512, 512);
  const r = rng(5);
  g.fillStyle = "#4a8a3c"; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 260; i++) {
    const x = r() * 512, y = r() * 512, rad = 20 + r() * 70;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    const l = r() > 0.5;
    gr.addColorStop(0, l ? "rgba(120,180,80,.28)" : "rgba(30,90,50,.3)"); gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  for (let i = 0; i < 5000; i++) {
    g.fillStyle = `rgba(${60 + r() * 60},${120 + r() * 70},${50 + r() * 40},.55)`;
    g.fillRect(r() * 512, r() * 512, 1, 2 + r() * 3);
  }
  for (let i = 0; i < 40; i++) {
    g.fillStyle = r() > 0.5 ? "rgba(255,244,210,.8)" : "rgba(255,200,230,.7)";
    g.fillRect(r() * 512, r() * 512, 2, 2);
  }
  return finish(c, true);
}

/** Paving tile (4 m) with joints. */
export function pavingTexture() {
  const [c, g] = canvas(256, 256);
  const r = rng(21);
  g.fillStyle = "#b9b3a4"; g.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
    const v = 168 + r() * 26;
    g.fillStyle = `rgb(${v},${v - 4},${v - 14})`; g.fillRect(x * 64 + 2, y * 64 + 2, 60, 60);
  }
  return finish(c, true);
}

/** Water relief (used as bump map). */
export function waterBump() {
  const [c, g] = canvas(256, 256);
  const img = g.createImageData(256, 256);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const u = (x / 256) * Math.PI * 2, v = (y / 256) * Math.PI * 2;
    const h = Math.sin(u * 3 + Math.sin(v * 2) * 1.6) * 0.5 + Math.sin(v * 5 + u * 2) * 0.3
      + Math.sin((u + v) * 7) * 0.2;
    const k = 128 + h * 70;
    const i = (y * 256 + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = k; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return finish(c, false);
}

export function glowTexture(inner = "rgba(255,255,255,1)", outer = "rgba(255,255,255,0)") {
  const [c, g] = canvas(128, 128);
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, inner); gr.addColorStop(0.35, inner.replace(/[\d.]+\)$/, "0.35)")); gr.addColorStop(1, outer);
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  return finish(c, true, false);
}

export function cloudTexture() {
  const [c, g] = canvas(256, 96);
  const r = rng(77);
  for (let i = 0; i < 26; i++) {
    const x = 40 + r() * 176, y = 30 + r() * 36, rad = 14 + r() * 26;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, "rgba(255,255,255,.55)"); gr.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  return finish(c, true, false);
}

/** Thermal band: contour-like amber bands, transparent at both ends and edges. */
export function heatTexture() {
  const [c, g] = canvas(256, 512);
  for (let i = 0; i < 9; i++) {
    const y = (i / 9) * 512;
    const gr = g.createLinearGradient(0, y, 0, y + 70);
    gr.addColorStop(0, "rgba(255,120,40,0)"); gr.addColorStop(0.5, `rgba(255,${120 + (i % 3) * 30},45,.55)`);
    gr.addColorStop(1, "rgba(255,120,40,0)");
    g.fillStyle = gr; g.fillRect(0, y, 256, 70);
  }
  g.globalCompositeOperation = "destination-in";
  const m = g.createLinearGradient(0, 0, 256, 0);
  m.addColorStop(0, "rgba(0,0,0,0)"); m.addColorStop(0.18, "rgba(0,0,0,1)");
  m.addColorStop(0.82, "rgba(0,0,0,1)"); m.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = m; g.fillRect(0, 0, 256, 512);
  const t = finish(c, true);
  t.wrapS = THREE.ClampToEdgeWrapping;
  return t;
}

/** Soft rectangular fade used for the shade corridor. */
export function fadeTexture(rgb: string) {
  const [c, g] = canvas(128, 256);
  const h = g.createLinearGradient(0, 0, 128, 0);
  h.addColorStop(0, `rgba(${rgb},0)`); h.addColorStop(0.5, `rgba(${rgb},.5)`); h.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = h; g.fillRect(0, 0, 128, 256);
  g.globalCompositeOperation = "destination-in";
  const v = g.createLinearGradient(0, 0, 0, 256);
  v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(0.2, "rgba(0,0,0,1)");
  v.addColorStop(0.8, "rgba(0,0,0,1)"); v.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = v; g.fillRect(0, 0, 128, 256);
  return finish(c, true, false);
}
