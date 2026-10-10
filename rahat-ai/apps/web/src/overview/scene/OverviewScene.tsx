import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, Lightformer } from "@react-three/drei";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { NearestMap, ReliefKind, SceneMode } from "../overviewData";
import { IDLE_SPEED, SWAY, detectQuality } from "./config";
import type { Highlight, Motion, Quality } from "./config";
import { DestinationPin, ReliefLayer, RouteLines, ThermalLayer } from "./Overlays";
import type { RouteTease } from "./Overlays";
import { Rider } from "./Rider";
import { Architecture, Flora, Lighting, Sky, Terrain } from "./World";

export interface SceneProps {
  mode: SceneMode; highlight: Highlight; nearest: NearestMap; tease: RouteTease | null;
  destination: string | null; chipHover: boolean; reduced: boolean; active: boolean;
  entrance: { world: number; rider: number };
  onReady: () => void; onFail: () => void;
  onHoverRelief: (k: ReliefKind | null) => void; onSelectRelief: (k: ReliefKind) => void;
}

const MARKER_X: Record<string, number> = { SHADE: 5.6, WATER: 9.0, REST: 5.4, COOLING: 15.5 };

function Particles({ motion, q, reduced }: { motion: Motion; q: Quality; reduced: boolean }) {
  const count = reduced ? 30 : Math.round(150 * q.density);
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const a = new Float32Array(count * 3), ph = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      a[i * 3] = (Math.random() - 0.5) * 30; a[i * 3 + 1] = Math.random() * 7; a[i * 3 + 2] = Math.random() * 44;
      ph[i] = Math.random() * 6.28;
    }
    g.setAttribute("position", new THREE.BufferAttribute(a, 3));
    g.setAttribute("ph", new THREE.BufferAttribute(ph, 1));
    return g;
  }, [count]);
  const u = useMemo(() => ({ uT: { value: 0 }, uD: { value: 0 }, uPx: { value: 1 } }), []);
  const gl = useThree(s => s.gl);
  useFrame(() => { u.uT.value = motion.time; u.uD.value = motion.dist; u.uPx.value = gl.getPixelRatio(); });
  return <points geometry={geo} frustumCulled={false}>
    <shaderMaterial uniforms={u} transparent depthWrite={false} blending={THREE.AdditiveBlending} fog={false}
      vertexShader={`attribute float ph; uniform float uT,uD,uPx; varying float vA;
        void main(){
          vec3 p = position;
          p.y = mod(p.y + uT * 0.12, 7.0);
          p.x += sin(uT * 0.4 + ph) * 0.6;
          p.z = mod(p.z + uD, 44.0) - 36.0;
          vA = smoothstep(0.0, 1.2, p.y) * smoothstep(7.0, 5.0, p.y) * (0.5 + 0.5 * sin(uT + ph));
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = (2.2 + ph * 0.25) * uPx * (22.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }`}
      fragmentShader={`varying float vA;
        void main(){ float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard;
          gl_FragColor = vec4(1.0, 0.96, 0.82, vA * 0.55 * smoothstep(0.5, 0.0, d)); }`} />
  </points>;
}

interface Preset { pos: [number, number, number]; look: [number, number, number]; fov: number }
const PRESETS: Record<SceneMode, Preset> = {
  idle: { pos: [-1.25, 2.0, 4.9], look: [0.3, 1.05, -6], fov: 48 },
  destination: { pos: [-1.0, 1.8, 4.3], look: [0.3, 1.1, -8], fov: 47 },
  relief: { pos: [-1.1, 1.9, 4.6], look: [0.3, 1.1, -8], fov: 48 },
  starting: { pos: [-0.4, 1.35, 3.6], look: [0, 1.2, -16], fov: 62 },
};

function CameraRig({ mode, highlight, chipHover, reduced, entrance }: Pick<SceneProps, "mode" | "highlight" | "chipHover" | "reduced" | "entrance">) {
  const ptr = useRef({ x: 0, y: 0 });
  const look = useRef(new THREE.Vector3(0.4, 1, -7));
  const tmp = useMemo(() => ({ p: new THREE.Vector3(), l: new THREE.Vector3() }), []);
  const { camera, size } = useThree();
  const shift = size.width < 1000 ? 1.25 : size.width < 1280 ? -0.9 : size.width / size.height > 1.35 ? 0 : -0.5;
  useEffect(() => {
    const move = (e: PointerEvent) => {
      ptr.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      ptr.current.y = (e.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener("pointermove", move, { passive: true });
    return () => window.removeEventListener("pointermove", move);
  }, []);
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    const wide = size.width / size.height > 1.35 && size.width > 1000;
    if (wide) cam.setViewOffset(size.width, size.height, -size.width * 0.1, 0, size.width, size.height);
    else cam.clearViewOffset();
    cam.near = 0.3; cam.far = 900; cam.updateProjectionMatrix();
  }, [camera, size]);
  useFrame(({ clock }, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const cam = camera as THREE.PerspectiveCamera;
    const pr = PRESETS[mode];
    const k = reduced ? 0.25 : 1;
    const mx = highlight.kind ? MARKER_X[highlight.kind] ?? 0 : 0;
    const t = clock.elapsedTime;
    const intro = 1 - Math.pow(1 - Math.min(entrance.world, 1), 3);
    tmp.p.set(
      pr.pos[0] + shift + ptr.current.x * 0.4 * k + Math.sin(t * 0.27) * 0.12 * k + mx * (mode === "relief" || highlight.kind ? 0.1 : 0) - (1 - intro) * 3.5,
      pr.pos[1] - ptr.current.y * 0.14 * k + Math.sin(t * 0.21) * 0.06 * k + (1 - intro) * 3.2,
      pr.pos[2] - (chipHover ? 0.35 : 0) + (1 - intro) * 7,
    );
    tmp.l.set(pr.look[0] + shift + ptr.current.x * 0.5 * k + mx * (highlight.kind ? 0.12 : 0), pr.look[1], pr.look[2]);
    const a = 1 - Math.exp(-dt * (mode === "starting" ? 2.6 : 1.8));
    cam.position.lerp(tmp.p, a);
    look.current.lerp(tmp.l, a);
    cam.lookAt(look.current);
    const f = THREE.MathUtils.damp(cam.fov, pr.fov, 2.2, dt);
    if (Math.abs(f - cam.fov) > 0.01) { cam.fov = f; cam.updateProjectionMatrix(); }
  });
  return null;
}

function Driver({ motion, mode, reduced, boost }: {
  motion: Motion; mode: SceneMode; reduced: boolean; boost: React.MutableRefObject<number>;
}) {
  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const target = mode === "starting" ? IDLE_SPEED * 2.1 : IDLE_SPEED * (reduced ? 0.45 : 1);
    motion.speed = THREE.MathUtils.damp(motion.speed, target, 1.6, dt);
    boost.current = THREE.MathUtils.damp(boost.current, mode === "starting" ? 1 : 0, 2, dt);
    motion.dist += motion.speed * dt;
    motion.time += dt;
    SWAY.uTime.value = motion.time;
    SWAY.uAmp.value = reduced ? 0.02 : 0.07;
  });
  return null;
}

function Ready({ onReady }: { onReady: () => void }) {
  const done = useRef(false);
  useFrame(() => { if (!done.current) { done.current = true; onReady(); } });
  return null;
}

export default function OverviewScene(p: SceneProps) {
  const q = useMemo(detectQuality, []);
  const motion = useMemo<Motion>(() => ({ dist: 0, speed: IDLE_SPEED, time: 0 }), []);
  const boost = useRef(0);
  const riderIn = useRef(0);
  riderIn.current = p.entrance.rider;
  return <Canvas shadows="soft" dpr={q.dpr} frameloop={p.active ? "always" : "never"}
    camera={{ position: [-5, 5.6, 13], fov: 50, near: 0.3, far: 900 }}
    gl={{ antialias: true, powerPreference: "high-performance", toneMappingExposure: 1.18 }}
    onCreated={({ gl }) => {
      gl.domElement.addEventListener("webglcontextlost", e => { e.preventDefault(); p.onFail(); });
    }}>
    <Driver motion={motion} mode={p.mode} reduced={p.reduced} boost={boost} />
    <Ready onReady={p.onReady} />
    <Sky />
    <Lighting q={q} />
    <Environment resolution={64} environmentIntensity={0.55}>
      <Lightformer form="rect" intensity={2.4} position={[-6, 6, -10]} scale={[14, 6, 1]} color="#fff0d2" />
      <Lightformer form="rect" intensity={1.2} position={[6, 3, 8]} scale={[10, 4, 1]} color="#bfe0ff" />
      <Lightformer form="ring" intensity={0.8} position={[0, 12, 0]} scale={10} color="#ffffff" />
    </Environment>
    <Terrain motion={motion} />
    <Flora q={q} motion={motion} />
    <Architecture q={q} motion={motion} />
    <Particles motion={motion} q={q} reduced={p.reduced} />
    <ThermalLayer motion={motion} highlight={p.highlight} />
    <RouteLines motion={motion} tease={p.tease} />
    <ReliefLayer nearest={p.nearest} active={p.highlight.kind} all={p.highlight.all} onHover={p.onHoverRelief} onSelect={p.onSelectRelief} />
    <DestinationPin name={p.destination} visible={p.mode !== "idle" && !!p.destination} />
    <Rider motion={motion} entrance={riderIn} speedBoost={boost} />
    <CameraRig mode={p.mode} highlight={p.highlight} chipHover={p.chipHover} reduced={p.reduced} entrance={p.entrance} />
  </Canvas>;
}
