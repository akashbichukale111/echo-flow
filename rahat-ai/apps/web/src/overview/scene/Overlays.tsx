import { Html, Line } from "@react-three/drei";
import type { ComponentRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { RELIEF_ICON } from "../icons";
import { RELIEF_KINDS, distLabel } from "../overviewData";
import type { NearestMap, ReliefKind } from "../overviewData";
import type { Highlight, Motion } from "./config";
import { fadeTexture, heatTexture } from "./textures";

const FLAT: [number, number, number] = [-Math.PI / 2, 0, 0];
const KIND_COLOR: Record<ReliefKind, string> = {
  SHADE: "#7df0c0", WATER: "#59c7ff", REST: "#bfe6a8", COOLING: "#8fe4ff",
};
const KIND_POS: Record<ReliefKind, [number, number, number]> = {
  SHADE: [5.2, 0.1, -10], WATER: [9.6, 0.12, -31], REST: [5.4, 0.1, -38], COOLING: [15.5, 0.1, -20],
};
const KIND_BLURB: Record<ReliefKind, string> = {
  SHADE: "Estimated relief opportunity", WATER: "Estimated relief opportunity",
  REST: "Estimated relief opportunity", COOLING: "Estimated relief opportunity",
};

export interface RouteTease { fastMin: number; rahatMin: number; lowerPct: number; same: boolean }

function Marker({ kind, meters, name, active, dim, onHover, onSelect }: {
  kind: ReliefKind; meters: number | null; name: string; active: boolean; dim: boolean;
  onHover: (k: ReliefKind | null) => void; onSelect: (k: ReliefKind) => void;
}) {
  const g = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const beam = useRef<THREE.MeshBasicMaterial>(null);
  const Icon = RELIEF_ICON[kind];
  const color = KIND_COLOR[kind];
  const phase = useMemo(() => RELIEF_KINDS.indexOf(kind) * 1.7, [kind]);
  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime + phase;
    const target = active ? 1.45 : 1;
    if (g.current) {
      const s = THREE.MathUtils.damp(g.current.scale.x, target, 6, dt);
      g.current.scale.setScalar(s);
      g.current.position.y = KIND_POS[kind][1] + Math.sin(t * 1.3) * 0.04;
    }
    if (ring.current) {
      const k = 1 + ((t * 0.5) % 1) * 0.9;
      ring.current.scale.setScalar(k);
      (ring.current.material as THREE.MeshBasicMaterial).opacity = (1 - ((t * 0.5) % 1)) * (active ? 0.9 : 0.55);
    }
    if (beam.current) beam.current.opacity = THREE.MathUtils.damp(beam.current.opacity, active ? 0.42 : dim ? 0.1 : 0.22, 6, dt);
  });
  return <group ref={g} position={KIND_POS[kind]}>
    <mesh ref={ring} rotation={FLAT}>
      <ringGeometry args={[0.8, 0.92, 40]} />
      <meshBasicMaterial color={color} transparent depthWrite={false} toneMapped={false} />
    </mesh>
    <mesh rotation={FLAT}>
      <circleGeometry args={[0.55, 32]} />
      <meshBasicMaterial color={color} transparent opacity={0.28} depthWrite={false} toneMapped={false} />
    </mesh>
    <mesh position={[0, 1.7, 0]}>
      <cylinderGeometry args={[0.04, 0.5, 3.4, 20, 1, true]} />
      <meshBasicMaterial ref={beam} color={color} transparent opacity={0.22} depthWrite={false}
        blending={THREE.AdditiveBlending} side={THREE.DoubleSide} toneMapped={false} />
    </mesh>
    <Html position={[0, 3.5, 0]} center zIndexRange={[18, 0]}>
      <div className={`relief-pin ${active ? "on" : ""} ${dim ? "dim" : ""}`} data-kind={kind.toLowerCase()}>
        <button type="button" onPointerEnter={() => onHover(kind)} onPointerLeave={() => onHover(null)}
          onFocus={() => onHover(kind)} onBlur={() => onHover(null)} onClick={() => onSelect(kind)}
          aria-label={`${kind.toLowerCase()} relief${meters != null ? `, ${distLabel(meters)}` : ""}. Show details`}>
          <Icon size={16} />
          <span>{kind}</span>
        </button>
        <div className="relief-tip" role="tooltip">
          <b>{kind} {meters != null ? `· ${distLabel(meters)}` : ""}</b>
          <span>{name}</span>
          <small>{KIND_BLURB[kind]} · DEMO DATA</small>
        </div>
      </div>
    </Html>
  </group>;
}

export function ReliefLayer({ nearest, active, all, onHover, onSelect }: {
  nearest: NearestMap; active: string | null; all: boolean;
  onHover: (k: ReliefKind | null) => void; onSelect: (k: ReliefKind) => void;
}) {
  return <>{RELIEF_KINDS.map(k => <Marker key={k} kind={k} meters={nearest[k]?.meters ?? null}
    name={nearest[k]?.poi.name ?? "No open point in demo data"} active={all || active === k}
    dim={!all && !!active && active !== k} onHover={onHover} onSelect={onSelect} />)}</>;
}

/** Localised thermal intelligence: a heat band on the road and a shade corridor beside it. */
export function ThermalLayer({ motion, highlight }: { motion: Motion; highlight: Highlight }) {
  const heat = useMemo(() => heatTexture(), []);
  const shade = useMemo(() => fadeTexture("125,240,192"), []);
  const hm = useRef<THREE.MeshBasicMaterial>(null);
  const sm = useRef<THREE.MeshBasicMaterial>(null);
  useFrame((_, dt) => {
    heat.offset.y = (motion.time * 0.06) % 1;
    if (hm.current) hm.current.opacity = THREE.MathUtils.damp(hm.current.opacity, highlight.thermal ? 0.95 : 0.5, 5, dt);
    if (sm.current) sm.current.opacity = THREE.MathUtils.damp(sm.current.opacity, highlight.kind === "SHADE" ? 1 : 0.62, 5, dt);
  });
  return <>
    <mesh rotation={FLAT} position={[0.4, 0.075, -30]}>
      <planeGeometry args={[7.4, 26]} />
      <meshBasicMaterial ref={hm} map={heat} transparent opacity={0.5} depthWrite={false} toneMapped={false}
        polygonOffset polygonOffsetFactor={-5} />
    </mesh>
    <mesh rotation={FLAT} position={[6.15, 0.085, -50]}>
      <planeGeometry args={[3.7, 64]} />
      <meshBasicMaterial ref={sm} map={shade} transparent opacity={0.62} depthWrite={false} toneMapped={false}
        polygonOffset polygonOffsetFactor={-5} />
    </mesh>
    <Html position={[-2.6, 0.6, -13]} center zIndexRange={[16, 0]}>
      <div className={`scene-tag thermal ${highlight.thermal ? "on" : ""}`}>
        <span>EST. THERMAL LOAD · HIGH</span><small>MODEL ESTIMATE</small>
      </div>
    </Html>
  </>;
}

export function RouteLines({ motion, tease }: { motion: Motion; tease: RouteTease | null }) {
  const fast = useRef<ComponentRef<typeof Line>>(null);
  const rahat = useRef<ComponentRef<typeof Line>>(null);
  const pts = useMemo(() => ({
    fast: [new THREE.Vector3(-1.7, 0.12, -6), new THREE.Vector3(-1.7, 0.12, -62), new THREE.Vector3(0.6, 0.12, -96)],
    rahat: new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.7, 0.12, -6), new THREE.Vector3(1.6, 0.12, -16), new THREE.Vector3(5.2, 0.12, -30),
      new THREE.Vector3(5.5, 0.12, -58), new THREE.Vector3(3.2, 0.12, -80), new THREE.Vector3(0.9, 0.12, -96),
    ]).getPoints(48),
  }), []);
  useFrame(() => {
    for (const r of [fast.current, rahat.current]) {
      const m = r?.material as unknown as { dashOffset: number } | undefined;
      if (m) m.dashOffset = -motion.time * 1.6;
    }
  });
  return <>
    <Line ref={fast} points={pts.fast} color="#ffab5c" lineWidth={3} dashed dashSize={1.1} gapSize={0.9} transparent opacity={0.9} />
    <Line ref={rahat} points={pts.rahat} color="#7df0c0" lineWidth={4} dashed dashSize={1.6} gapSize={0.5} transparent opacity={0.95} />
    {tease && <>
      <Html position={[1.4, 1.2, -26]} center zIndexRange={[14, 0]}>
        <div className="route-pill fast"><span>FASTEST</span><b>{tease.fastMin} min</b></div>
      </Html>
      <Html position={[3.4, 1.0, -9]} center zIndexRange={[14, 0]}>
        <div className="route-pill rahat"><span>RAHAT</span><b>{tease.rahatMin} min</b>
          <small>{tease.same ? "Same path as fastest" : `${Math.abs(tease.lowerPct)}% ${tease.lowerPct >= 0 ? "lower" : "higher"} est. thermal load`}</small></div>
      </Html>
    </>}
  </>;
}

export function DestinationPin({ name, visible }: { name: string | null; visible: boolean }) {
  const g = useRef<THREE.Group>(null);
  useFrame(({ clock }, dt) => {
    if (!g.current) return;
    const s = THREE.MathUtils.damp(g.current.scale.x, visible ? 1 : 0.001, 4, dt);
    g.current.scale.setScalar(s);
    g.current.rotation.y = clock.elapsedTime * 0.6;
  });
  return <group ref={g} position={[1.4, 0, -96]} scale={0.001}>
    <mesh position={[0, 5, 0]}>
      <cylinderGeometry args={[0.05, 0.9, 10, 20, 1, true]} />
      <meshBasicMaterial color="#ffffff" transparent opacity={0.28} depthWrite={false} blending={THREE.AdditiveBlending}
        side={THREE.DoubleSide} toneMapped={false} />
    </mesh>
    <mesh rotation={FLAT} position={[0, 0.1, 0]}>
      <ringGeometry args={[1.5, 1.8, 40]} />
      <meshBasicMaterial color="#ffd9a0" transparent opacity={0.9} depthWrite={false} toneMapped={false} />
    </mesh>
    {visible && name && <Html position={[0, 10.8, 0]} center zIndexRange={[12, 0]}>
      <div className="dest-pin"><span>DESTINATION</span><b>{name}</b></div>
    </Html>}
  </group>;
}
