import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { rng } from "./textures";

const UP = new THREE.Vector3(0, 1, 0);

/** Hard-surface piece: keeps primitive normals, adds a flat vertex colour. */
function hard(g: THREE.BufferGeometry, color: THREE.ColorRepresentation, m?: THREE.Matrix4) {
  if (m) g.applyMatrix4(m);
  g.deleteAttribute("uv");
  const c = new THREE.Color(color);
  const n = g.getAttribute("position").count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute("color", new THREE.BufferAttribute(a, 3));
  return g;
}
const mat = (p: [number, number, number], s: [number, number, number] = [1, 1, 1], ry = 0) =>
  new THREE.Matrix4().compose(new THREE.Vector3(...p),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), new THREE.Vector3(...s));

/** Lumpy foliage: displaced icosphere, smooth normals, dark-to-light height gradient. */
export function clump(seed: number, radius: number, squash = 1, lo = "#2a6b3c", hi = "#7fbf5a") {
  const r = rng(seed);
  const ph = [r() * 6, r() * 6, r() * 6];
  let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(radius, 2);
  g.deleteAttribute("uv"); g.deleteAttribute("normal");
  const p = g.getAttribute("position");
  const cLo = new THREE.Color(lo), cHi = new THREE.Color(hi);
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + 0.2 * Math.sin(x * 1.7 + ph[0]) * Math.cos(z * 1.9 + ph[1]) + 0.12 * Math.sin(y * 2.6 + ph[2]);
    p.setXYZ(i, x * k, y * k * squash, z * k);
    const t = THREE.MathUtils.clamp((y / radius + 1) / 2 + (Math.sin(x * 5 + z * 4 + ph[0]) * 0.1), 0, 1);
    const c = cLo.clone().lerp(cHi, t);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g = mergeVertices(g, 1e-3);
  g.computeVertexNormals();
  return g;
}
function moved(g: THREE.BufferGeometry, x: number, y: number, z: number) {
  g.translate(x, y, z);
  return g;
}
function merge(list: THREE.BufferGeometry[]) {
  const out = mergeGeometries(list, false);
  list.forEach(l => l.dispose());
  return out;
}

export function trunkGeometry(h = 2.6) {
  const g = new THREE.CylinderGeometry(0.1, 0.2, h, 7, 1);
  g.translate(0, h / 2, 0);
  return hard(g, "#6b5240");
}

/** Foliage variants. All carry vertex colours; position 0 is the base on the ground. */
export function broadleaf(seed: number) {
  return merge([
    moved(clump(seed, 1.7), 0, 4.0, 0),
    moved(clump(seed + 1, 1.25, 0.9), 1.1, 3.4, 0.5),
    moved(clump(seed + 2, 1.15, 0.9), -1.0, 3.3, -0.5),
    moved(clump(seed + 3, 1.0), 0.1, 5.1, -0.3),
  ]);
}
export function slender(seed: number) {
  return merge([
    moved(clump(seed, 0.9, 2.6, "#235d3a", "#6fae55"), 0, 3.4, 0),
    moved(clump(seed + 1, 0.7, 2.0, "#235d3a", "#6fae55"), 0.15, 5.6, 0.1),
  ]);
}
export function umbrella(seed: number) {
  return merge([
    moved(clump(seed, 2.9, 0.34, "#2c7040", "#8cc962"), 0, 5.2, 0),
    moved(clump(seed + 1, 1.8, 0.4, "#2c7040", "#8cc962"), 2.2, 4.7, 1.0),
    moved(clump(seed + 2, 1.8, 0.4, "#2c7040", "#8cc962"), -2.1, 4.6, -1.1),
  ]);
}
export function shrub(seed: number) {
  return merge([
    moved(clump(seed, 0.55, 0.75, "#2f7040", "#8ccf6a"), 0, 0.4, 0),
    moved(clump(seed + 1, 0.4, 0.8, "#3a8348", "#a3d97b"), 0.45, 0.3, 0.2),
  ]);
}
export function trunkTall(h: number, r0: number, r1: number) {
  const g = new THREE.CylinderGeometry(r1, r0, h, 8, 1);
  g.translate(0, h / 2, 0);
  return hard(g, "#6b5240");
}

/** Supertree: flared concrete trunk, curved branches, disc canopies, glowing rings. */
export function superTree(seed: number) {
  const r = rng(seed);
  const H = 15;
  const struct: THREE.BufferGeometry[] = [];
  const leaf: THREE.BufferGeometry[] = [];
  const glow: THREE.BufferGeometry[] = [];
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 26; i++) {
    const y = (i / 26) * H;
    pts.push(new THREE.Vector2(0.5 + 1.7 * Math.exp(-y / 2.1) + 0.1 * Math.sin(y * 1.3), y));
  }
  struct.push(hard(new THREE.LatheGeometry(pts, 14), "#8b7a68"));
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2 + r() * 0.35;
    const y0 = H * (0.5 + 0.42 * r());
    const reach = 4.2 + r() * 3.6;
    const rise = 2.4 + r() * 2.2;
    const c = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, y0, 0),
      new THREE.Vector3(Math.cos(a) * reach * 0.4, y0 + rise * 0.35, Math.sin(a) * reach * 0.4),
      new THREE.Vector3(Math.cos(a) * reach, y0 + rise, Math.sin(a) * reach),
    ]);
    struct.push(hard(new THREE.TubeGeometry(c, 8, 0.14, 6, false), "#7d6c5c"));
    const end = c.getPoint(1);
    const rad = 1.8 + r() * 1.1;
    leaf.push(moved(clump(seed * 7 + k, rad, 0.32, "#2a6b3c", "#86c45c"), end.x, end.y + 0.25, end.z));
    const ring = new THREE.TorusGeometry(rad * 0.62, 0.05, 6, 24);
    ring.rotateX(Math.PI / 2);
    glow.push(hard(ring, "#9dfbd3", mat([end.x, end.y - 0.35, end.z])));
  }
  leaf.push(moved(clump(seed * 13, 3.6, 0.36, "#2a6b3c", "#8fcf63"), 0, H + 0.4, 0));
  const top = new THREE.TorusGeometry(2.3, 0.06, 6, 32);
  top.rotateX(Math.PI / 2);
  glow.push(hard(top, "#9dfbd3", mat([0, H - 0.1, 0])));
  return { struct: merge(struct), leaf: merge(leaf), glow: merge(glow) };
}

/** Terraced green tower: stacked elliptical slabs, planter rings, glass core. */
export function terraceTower(levels = 6) {
  const body: THREE.BufferGeometry[] = [];
  const glass: THREE.BufferGeometry[] = [];
  let y = 0;
  for (let i = 0; i < levels; i++) {
    const rad = 5.2 - i * 0.45;
    const h = 3.1;
    glass.push(hard(new THREE.CylinderGeometry(rad * 0.82, rad * 0.84, h, 28), "#4f7f88", mat([0, y + h / 2, 0], [1.2, 1, 0.9])));
    body.push(hard(new THREE.CylinderGeometry(rad, rad, 0.32, 36), "#eef0ea", mat([0, y + h, 0], [1.2, 1, 0.9])));
    const ring = new THREE.TorusGeometry(rad * 1.04, 0.32, 8, 40);
    ring.rotateX(Math.PI / 2);
    body.push(hard(ring, i % 2 ? "#4f9a4c" : "#3e8a50", mat([0, y + h + 0.3, 0], [1.2, 1, 0.9])));
    y += h;
  }
  body.push(moved(clump(3, 2.0, 0.6, "#2c7040", "#8ccf6a"), 0, y + 0.9, 0));
  return { body: merge(body), glass: merge(glass) };
}

/** Slender tapered skyline tower with green terraces. */
export function skylineTower(sides: number, taper: number) {
  const body: THREE.BufferGeometry[] = [];
  const h = 10;
  body.push(hard(new THREE.CylinderGeometry(taper, 1, h, sides), "#8fb4b8", mat([0, h / 2, 0])));
  for (let i = 1; i < 5; i++) {
    const t = i / 5;
    const rad = 1 + (taper - 1) * t;
    const ring = new THREE.CylinderGeometry(rad * 1.08, rad * 1.08, 0.12, sides);
    body.push(hard(ring, i % 2 ? "#5da25a" : "#e9efe9", mat([0, h * t, 0])));
  }
  body.push(hard(new THREE.ConeGeometry(taper * 0.35, 1.6, 6), "#dfe9e6", mat([0, h + 0.8, 0])));
  return merge(body);
}

/** Elevated pedestrian arch over the road, with tree-column supports. */
export function skywalk(span = 15, peak = 8.4) {
  const deck: THREE.BufferGeometry[] = [];
  const glass: THREE.BufferGeometry[] = [];
  const green: THREE.BufferGeometry[] = [];
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-span, 3.2, 0), new THREE.Vector3(-span * 0.55, 6.0, 0),
    new THREE.Vector3(0, peak, 0), new THREE.Vector3(span * 0.55, 6.0, 0), new THREE.Vector3(span, 3.2, 0),
  ]);
  const N = 40;
  const q = new THREE.Quaternion();
  for (let i = 0; i < N; i++) {
    const a = curve.getPoint(i / N), b = curve.getPoint((i + 1) / N);
    const d = b.clone().sub(a);
    const len = d.length();
    q.setFromUnitVectors(new THREE.Vector3(1, 0, 0), d.clone().normalize());
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const place = (off: THREE.Vector3, size: [number, number, number]) => new THREE.Matrix4().compose(
      mid.clone().add(off), q, new THREE.Vector3(...size));
    deck.push(hard(new THREE.BoxGeometry(len * 1.02, 0.28, 3.0), "#e9ebe4", place(new THREE.Vector3(0, 0, 0), [1, 1, 1])));
    for (const s of [-1, 1]) {
      glass.push(hard(new THREE.BoxGeometry(len * 1.02, 0.95, 0.05), "#9fd6dc", place(new THREE.Vector3(0, 0.62, s * 1.48), [1, 1, 1])));
      deck.push(hard(new THREE.BoxGeometry(len * 1.02, 0.07, 0.1), "#dfe3dc", place(new THREE.Vector3(0, 1.12, s * 1.48), [1, 1, 1])));
      if (i % 4 === 1) green.push(moved(clump(i + 40, 0.5, 0.7, "#2f7040", "#8ccf6a"), mid.x, mid.y + 0.45, s * 1.15));
    }
  }
  for (const s of [-1, 1]) {
    const pr: THREE.Vector2[] = [];
    for (let i = 0; i <= 14; i++) {
      const y = (i / 14) * 3.4;
      pr.push(new THREE.Vector2(0.28 + 0.7 * Math.exp(-y / 0.9), y));
    }
    deck.push(hard(new THREE.LatheGeometry(pr, 12), "#8b7a68", mat([s * span, 0, 0])));
    green.push(moved(clump(90 + s, 2.0, 0.45, "#2a6b3c", "#86c45c"), s * span, 3.9, 0));
  }
  return { deck: merge(deck), glass: merge(glass), green: merge(green) };
}

/** Cantilevered relief pavilion: curved roof on slender columns, with a bench. */
export function pavilion() {
  const wood: THREE.BufferGeometry[] = [];
  const roof: THREE.BufferGeometry[] = [];
  const cap = new THREE.SphereGeometry(1, 28, 8, 0, Math.PI * 2, 0, 0.55);
  roof.push(hard(cap, "#f2f3ee", mat([0, 2.35, 0], [4.4, 3.2, 2.6], 0)));
  roof.push(moved(clump(61, 1.4, 0.3, "#2f7040", "#8ccf6a"), -1.2, 3.55, 0.3));
  roof.push(moved(clump(62, 1.2, 0.3, "#2f7040", "#8ccf6a"), 1.4, 3.5, -0.3));
  for (const s of [-1, 1]) {
    const c = new THREE.CatmullRomCurve3([
      new THREE.Vector3(s * 3.3, 0, 0.8), new THREE.Vector3(s * 3.0, 1.4, 0.6), new THREE.Vector3(s * 2.2, 3.1, 0)]);
    wood.push(hard(new THREE.TubeGeometry(c, 10, 0.1, 6, false), "#a9835d"));
  }
  wood.push(hard(new THREE.BoxGeometry(3.4, 0.1, 0.55), "#b48a5c", mat([0, 0.5, 0.5])));
  wood.push(hard(new THREE.BoxGeometry(3.4, 0.5, 0.08), "#7d6c5c", mat([0, 0.25, 0.5])));
  return { wood: merge(wood), roof: merge(roof) };
}

export function orient(a: THREE.Vector3, b: THREE.Vector3, target: THREE.Object3D, base = 1) {
  const d = b.clone().sub(a);
  const len = d.length();
  target.position.copy(a).addScaledVector(d, 0.5);
  target.quaternion.setFromUnitVectors(UP, d.normalize());
  target.scale.y = len / base;
}
