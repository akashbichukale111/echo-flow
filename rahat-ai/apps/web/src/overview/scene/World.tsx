import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { LEN, ROAD_W, SUN_DIR } from "./config";
import type { Motion, Quality } from "./config";
import * as G from "./geometry";
import { Scatter, Scroller, useFoliageMaterial } from "./instancing";
import type { Item } from "./instancing";
import { cloudTexture, glowTexture, grassTexture, pavingTexture, rng, roadTexture, waterBump } from "./textures";

const HAZE = "#d6e4d8";

export function Sky() {
  const sun = useMemo(() => glowTexture("rgba(255,244,214,1)"), []);
  const cloud = useMemo(() => cloudTexture(), []);
  const clouds = useRef<THREE.Group>(null);
  const uniforms = useMemo(() => ({
    uSun: { value: SUN_DIR.clone() },
    uTop: { value: new THREE.Color("#3f88bd") }, uMid: { value: new THREE.Color("#9ccfd9") },
    uHaze: { value: new THREE.Color(HAZE) }, uWarm: { value: new THREE.Color("#ffd9a0") },
  }), []);
  useFrame(({ clock }) => {
    if (clouds.current) clouds.current.position.x = Math.sin(clock.elapsedTime * 0.01) * 60;
  });
  const sunPos = SUN_DIR.clone().multiplyScalar(520);
  return <>
    <mesh renderOrder={-10} frustumCulled={false}>
      <sphereGeometry args={[600, 32, 16]} />
      <shaderMaterial side={THREE.BackSide} depthWrite={false} fog={false} uniforms={uniforms}
        vertexShader={`varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`}
        fragmentShader={`varying vec3 vP; uniform vec3 uSun,uTop,uMid,uHaze,uWarm;
          void main(){
            float h = clamp(vP.y, 0.0, 1.0);
            vec3 c = mix(uHaze, uMid, smoothstep(0.0, 0.22, h));
            c = mix(c, uTop, smoothstep(0.18, 0.75, h));
            float s = max(dot(normalize(vP), uSun), 0.0);
            c += uWarm * pow(s, 8.0) * 0.55 + uWarm * pow(s, 64.0) * 0.5;
            gl_FragColor = vec4(c, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`} />
    </mesh>
    <sprite position={sunPos} scale={[240, 240, 1]}>
      <spriteMaterial map={sun} transparent depthWrite={false} fog={false} blending={THREE.AdditiveBlending} opacity={0.85} />
    </sprite>
    <group ref={clouds}>
      {[[-180, 120, -420, 220], [60, 150, -460, 260], [230, 110, -400, 200], [-40, 95, -380, 160]].map(([x, y, z, w], i) =>
        <sprite key={i} position={[x, y, z]} scale={[w, w * 0.36, 1]}>
          <spriteMaterial map={cloud} transparent depthWrite={false} fog={false} opacity={0.55} />
        </sprite>)}
    </group>
  </>;
}

export function Lighting({ q }: { q: Quality }) {
  const key = useRef<THREE.DirectionalLight>(null);
  const { scene } = useThree();
  useEffect(() => {
    scene.fog = new THREE.Fog(HAZE, 24, 330);
    scene.background = new THREE.Color(HAZE);
    return () => { scene.fog = null; };
  }, [scene]);
  useEffect(() => {
    const l = key.current;
    if (!l) return;
    l.target.position.set(0, 0, -8);
    l.target.updateMatrixWorld();
  }, []);
  useFrame(({ clock }) => {
    const l = key.current;
    if (!l) return;
    const swing = Math.sin(clock.elapsedTime * 0.05) * 0.06;
    const d = new THREE.Vector3(SUN_DIR.x + swing, SUN_DIR.y, SUN_DIR.z).normalize().multiplyScalar(46);
    l.position.set(d.x, d.y, d.z - 8);
  });
  return <>
    <hemisphereLight args={["#d8ecff", "#5a7d44", 1.1]} />
    <directionalLight ref={key} intensity={3.4} color="#ffe2b4" castShadow shadow-mapSize={[q.shadow, q.shadow]}
      shadow-camera-left={-22} shadow-camera-right={22} shadow-camera-top={26} shadow-camera-bottom={-26}
      shadow-camera-near={1} shadow-camera-far={110} shadow-bias={-0.0004} shadow-normalBias={0.05} />
    <directionalLight position={[3, 5, 18]} intensity={0.85} color="#cfe6ff" />
  </>;
}

export function Terrain({ motion }: { motion: Motion }) {
  const road = useMemo(() => roadTexture(), []);
  const grass = useMemo(() => grassTexture(), []);
  const paving = useMemo(() => pavingTexture(), []);
  const bump = useMemo(() => waterBump(), []);
  useEffect(() => {
    grass.repeat.set(70, 70); paving.repeat.set(2.4 / 4, 400 / 4);
    road.repeat.set(1, 400 / 14); bump.repeat.set(1.2, 90);
  }, [grass, paving, road, bump]);
  useFrame(() => {
    road.offset.y = motion.dist / 14;
    grass.offset.y = motion.dist / 6;
    paving.offset.y = motion.dist / 4;
    bump.offset.y = motion.dist / 6 + motion.time * 0.05;
    bump.offset.x = motion.time * 0.02;
  });
  const flat: [number, number, number] = [-Math.PI / 2, 0, 0];
  return <group>
    <mesh rotation={flat} position={[0, 0, -150]} receiveShadow>
      <planeGeometry args={[420, 600]} />
      <meshStandardMaterial map={grass} roughness={1} />
    </mesh>
    <mesh rotation={flat} position={[0, 0.03, -170]} receiveShadow>
      <planeGeometry args={[ROAD_W, 400]} />
      <meshStandardMaterial map={road} roughness={0.82} metalness={0.05} polygonOffset polygonOffsetFactor={-2} />
    </mesh>
    {[-1, 1].map(s => <group key={s}>
      <mesh rotation={flat} position={[s * 6.15, 0.05, -170]} receiveShadow>
        <planeGeometry args={[3.7, 400]} />
        <meshStandardMaterial map={paving} roughness={0.9} polygonOffset polygonOffsetFactor={-2} />
      </mesh>
      <mesh position={[s * 4.3, 0.09, -170]} receiveShadow castShadow>
        <boxGeometry args={[0.28, 0.18, 400]} />
        <meshStandardMaterial color="#cfcabb" roughness={0.9} />
      </mesh>
    </group>)}
    <mesh rotation={flat} position={[10.6, 0.04, -170]}>
      <planeGeometry args={[4.4, 400]} />
      <meshStandardMaterial color="#2c98a4" roughness={0.04} metalness={0.25} bumpMap={bump} bumpScale={0.6}
        envMapIntensity={1.4} transparent opacity={0.92} polygonOffset polygonOffsetFactor={-3} />
    </mesh>
    {[8.2, 13.0].map(x => <mesh key={x} position={[x, 0.07, -170]} castShadow receiveShadow>
      <boxGeometry args={[0.45, 0.28, 400]} />
      <meshStandardMaterial color="#d9d4c6" roughness={0.85} />
    </mesh>)}
  </group>;
}

function layout(seed: number, n: number, xs: [number, number], zJitter = 1): Item[] {
  const r = rng(seed);
  return Array.from({ length: n }, (_, i) => ({
    p: [xs[0] + r() * (xs[1] - xs[0]), 0, -(i + r() * zJitter) * (LEN / n)] as [number, number, number],
    s: 0.8 + r() * 0.7, ry: r() * 6.28,
  }));
}

export function Flora({ q, motion }: { q: Quality; motion: Motion }) {
  const foliage = useFoliageMaterial();
  const trunkMat = useMemo(() => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }), []);
  const geos = useMemo(() => ({
    a: [G.broadleaf(3), G.broadleaf(9)], slim: G.slender(21), umb: G.umbrella(31), shrub: [G.shrub(41), G.shrub(55)],
    trunk: G.trunkTall(3.2, 0.2, 0.11), trunkBig: G.trunkTall(5.2, 0.3, 0.18),
  }), []);
  const d = q.density;
  const L = useMemo(() => {
    const cnt = (n: number) => Math.max(4, Math.round(n * d));
    const street = (side: number, seed: number) => layout(seed, cnt(16), [5.3, 5.7]).map(i => ({ ...i, p: [i.p[0] * side, 0, i.p[2]] as Item["p"], s: 0.8 + (i.s ?? 1) * 0.3 }));
    const grove = (side: number, seed: number, n: number, xs: [number, number]) =>
      layout(seed, cnt(n), xs).map(i => ({ ...i, p: [i.p[0] * side, 0, i.p[2]] as Item["p"] }));
    const tint = ["#ffffff", "#e8f5d8", "#d0e8c0", "#f4ffe6"];
    const tinted = (a: Item[]) => a.map((i, k) => ({ ...i, tint: tint[k % 4] }));
    const sl = street(-1, 2), sr = street(1, 3);
    const gl = tinted(grove(-1, 4, 34, [9, 28])), gr = tinted(grove(1, 5, 30, [15.5, 34]));
    const umbL = grove(-1, 6, 10, [8, 16]).map(i => ({ ...i, s: 1.1 + (i.s ?? 1) * 0.5 }));
    const umbR = grove(1, 7, 8, [17, 26]).map(i => ({ ...i, s: 1.1 + (i.s ?? 1) * 0.5 }));
    const slimL = grove(-1, 8, 14, [7, 14]), slimR = grove(1, 9, 12, [15, 24]);
    const shrubs = [...grove(-1, 10, 70, [4.9, 10]), ...grove(1, 11, 60, [4.9, 6.2]), ...grove(1, 12, 50, [13.8, 20])]
      .map((i, k) => ({ ...i, s: 0.9 + (i.s ?? 1) * 0.9, tint: tint[k % 4] }));
    return { sl, sr, gl, gr, umbL, umbR, slimL, slimR, shrubs };
  }, [d]);
  const half = (a: Item[], odd: boolean) => a.filter((_, i) => (i % 2 === 1) === odd);
  const street = [...L.sl, ...L.sr];
  const grove = [...L.gl, ...L.gr];
  const umb = [...L.umbL, ...L.umbR];
  const slim = [...L.slimL, ...L.slimR];
  return <Scroller motion={motion}>
    <Scatter geometry={geos.a[0]} material={foliage} items={half(street, false)} />
    <Scatter geometry={geos.a[1]} material={foliage} items={half(street, true)} />
    <Scatter geometry={geos.trunk} material={trunkMat} items={street} />
    <Scatter geometry={geos.a[0]} material={foliage} items={half(grove, false)} />
    <Scatter geometry={geos.a[1]} material={foliage} items={half(grove, true)} />
    <Scatter geometry={geos.trunk} material={trunkMat} items={grove} />
    <Scatter geometry={geos.umb} material={foliage} items={umb} />
    <Scatter geometry={geos.trunkBig} material={trunkMat} items={umb} />
    <Scatter geometry={geos.slim} material={foliage} items={slim} />
    <Scatter geometry={geos.shrub[0]} material={foliage} items={half(L.shrubs, false)} cast={false} />
    <Scatter geometry={geos.shrub[1]} material={foliage} items={half(L.shrubs, true)} cast={false} />
  </Scroller>;
}

const glassMat = () => new THREE.MeshStandardMaterial({
  vertexColors: true, color: "#ffffff", roughness: 0.18, metalness: 0.55, envMapIntensity: 1.5,
});

export function Architecture({ q, motion }: { q: Quality; motion: Motion }) {
  const foliage = useFoliageMaterial();
  const concrete = useMemo(() => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.02 }), []);
  const glass = useMemo(glassMat, []);
  const glowMat = useMemo(() => new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }), []);
  const g = useMemo(() => ({
    st: [G.superTree(1), G.superTree(2), G.superTree(3)],
    terr: G.terraceTower(6), terr2: G.terraceTower(4),
    walk: G.skywalk(), pav: G.pavilion(),
  }), []);
  const sky = useMemo(() => ({
    t6: G.skylineTower(6, 0.55), t4: G.skylineTower(4, 0.3), t8: G.skylineTower(8, 0.7),
    st: G.superTree(4),
  }), []);
  const near = useMemo(() => {
    const items = (n: number, xs: [number, number], side: number, seed: number): Item[] => {
      const rr = rng(seed);
      return Array.from({ length: n }, (_, i) => ({
        p: [side * (xs[0] + rr() * (xs[1] - xs[0])), 0, -(i + 0.3 + rr() * 0.4) * (LEN / n)] as Item["p"],
        s: 0.8 + rr() * 0.8, ry: rr() * 6.28,
      }));
    };
    return {
      stL: [items(2, [24, 30], -1, 1), items(2, [26, 32], -1, 5)], stR: [items(2, [30, 38], 1, 2), items(2, [36, 44], 1, 6)],
      terrL: items(Math.round(3 * q.density + 1), [34, 46], -1, 7), terrR: items(Math.round(3 * q.density + 1), [46, 60], 1, 8),
      pav: [{ p: [-6.4, 0.06, -34] as Item["p"], ry: Math.PI / 2 }, { p: [6.2, 0.06, -104] as Item["p"], ry: -Math.PI / 2 }],
      walk: [{ p: [0, 0, -58] as Item["p"] }],
    };
  }, [q.density]);
  const far = useMemo(() => {
    const rr = rng(404);
    const towers: Record<string, Item[]> = { t6: [], t4: [], t8: [] };
    const keys = ["t6", "t4", "t8"];
    const n = q.low ? 22 : 40;
    for (let i = 0; i < n; i++) {
      const side = i % 2 ? 1 : -1;
      const x = side * (28 + rr() * 150);
      const z = -(190 + rr() * 110);
      towers[keys[i % 3]].push({ p: [x, 0, z], s: 5 + rr() * 6, sy: 1.6 + rr() * 2.4, ry: rr() * 3 });
    }
    const giants: Item[] = [
      { p: [-58, 0, -200], s: 4.2, ry: 0.3 }, { p: [62, 0, -230], s: 4.8, ry: 1.2 },
      { p: [-120, 0, -260], s: 5.2, ry: 2.0 }, { p: [20, 0, -290], s: 5.6, ry: 0.6 },
      { p: [130, 0, -250], s: 4.6, ry: 2.6 },
    ];
    return { towers, giants };
  }, [q.low]);
  const stuff = (sel: number) => g.st[sel];
  return <>
    <Scroller motion={motion}>
      {[0, 1].map(k => <group key={k}>
        <Scatter geometry={stuff(k).struct} material={concrete} items={near.stL[k]} />
        <Scatter geometry={stuff(k).leaf} material={foliage} items={near.stL[k]} />
        <Scatter geometry={stuff(k).glow} material={glowMat} items={near.stL[k]} cast={false} />
        <Scatter geometry={stuff(k + 1).struct} material={concrete} items={near.stR[k]} />
        <Scatter geometry={stuff(k + 1).leaf} material={foliage} items={near.stR[k]} />
        <Scatter geometry={stuff(k + 1).glow} material={glowMat} items={near.stR[k]} cast={false} />
      </group>)}
      <Scatter geometry={g.terr.body} material={concrete} items={near.terrL} />
      <Scatter geometry={g.terr.glass} material={glass} items={near.terrL} />
      <Scatter geometry={g.terr2.body} material={concrete} items={near.terrR} />
      <Scatter geometry={g.terr2.glass} material={glass} items={near.terrR} />
      <Scatter geometry={g.walk.deck} material={concrete} items={near.walk} />
      <Scatter geometry={g.walk.glass} material={glass} items={near.walk} cast={false} />
      <Scatter geometry={g.walk.green} material={foliage} items={near.walk} />
      <Scatter geometry={g.pav.wood} material={concrete} items={near.pav} />
      <Scatter geometry={g.pav.roof} material={concrete} items={near.pav} />
    </Scroller>
    <group>
      <Scatter geometry={sky.t6} material={glass} items={far.towers.t6} cast={false} />
      <Scatter geometry={sky.t4} material={glass} items={far.towers.t4} cast={false} />
      <Scatter geometry={sky.t8} material={glass} items={far.towers.t8} cast={false} />
      <Scatter geometry={sky.st.struct} material={concrete} items={far.giants} cast={false} />
      <Scatter geometry={sky.st.leaf} material={foliage} items={far.giants} cast={false} />
      <Scatter geometry={sky.st.glow} material={glowMat} items={far.giants} cast={false} />
    </group>
  </>;
}
