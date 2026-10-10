import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { RoundedBox } from "@react-three/drei";
import type { Motion } from "./config";
import { glowTexture } from "./textures";

type V3 = [number, number, number];
const UP = new THREE.Vector3(0, 1, 0);
const WHEEL_R = 0.34;
const FRAME = "#27b58a";
const SKIN = "#c68e6a";

/** Straight tube between two points (static pose). */
function Bar({ a, b, r = 0.016, color = FRAME, metal = 0.5 }: { a: V3; b: V3; r?: number; color?: string; metal?: number }) {
  const { pos, quat, len } = useMemo(() => {
    const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
    const d = vb.clone().sub(va);
    return { pos: va.clone().add(vb).multiplyScalar(0.5), quat: new THREE.Quaternion().setFromUnitVectors(UP, d.clone().normalize()), len: d.length() };
  }, [a, b]);
  return <mesh position={pos} quaternion={quat} castShadow>
    <cylinderGeometry args={[r, r, len, 8]} />
    <meshStandardMaterial color={color} roughness={0.35} metalness={metal} />
  </mesh>;
}

function Wheel({ hub, rot }: { hub: V3; rot: React.RefObject<THREE.Group> }) {
  const spokes = useMemo(() => {
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 18; i++) {
      const g = new THREE.CylinderGeometry(0.003, 0.003, WHEEL_R * 1.9, 3);
      g.rotateX(Math.PI / 2);
      g.rotateX((i / 18) * Math.PI);
      parts.push(g);
    }
    const out = new THREE.BufferGeometry();
    const pos: number[] = [], idx: number[] = [];
    let off = 0;
    for (const p of parts) {
      const pa = p.getAttribute("position");
      for (let i = 0; i < pa.count; i++) pos.push(pa.getX(i), pa.getY(i), pa.getZ(i));
      const ia = p.getIndex();
      if (ia) for (let i = 0; i < ia.count; i++) idx.push(ia.getX(i) + off);
      off += pa.count;
    }
    out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    out.setIndex(idx);
    out.computeVertexNormals();
    return out;
  }, []);
  return <group position={hub}>
    <group ref={rot}>
      <mesh rotation={[0, Math.PI / 2, 0]} castShadow>
        <torusGeometry args={[WHEEL_R - 0.03, 0.03, 10, 48]} />
        <meshStandardMaterial color="#14181a" roughness={0.85} />
      </mesh>
      <mesh rotation={[0, Math.PI / 2, 0]}>
        <torusGeometry args={[WHEEL_R - 0.065, 0.008, 8, 48]} />
        <meshStandardMaterial color="#cfd8dc" metalness={0.9} roughness={0.25} />
      </mesh>
      <mesh geometry={spokes}><meshStandardMaterial color="#aab6bb" metalness={0.8} roughness={0.35} /></mesh>
      <mesh rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.03, 0.03, 0.1, 12]} />
        <meshStandardMaterial color="#8d999e" metalness={0.8} roughness={0.3} />
      </mesh>
      <mesh position={[0, WHEEL_R - 0.065, 0]}>
        <sphereGeometry args={[0.012, 8, 6]} />
        <meshBasicMaterial color="#9dfbd3" />
      </mesh>
    </group>
  </group>;
}

const HIP: V3 = [0, 0.97, 0.24];
const BB: V3 = [0, 0.28, 0.12];
const THIGH = 0.43, SHIN = 0.43, UPPER = 0.28, FORE = 0.26, CRANK = 0.17;
const GRIP = (s: number): V3 => [s * 0.23, 0.95, -0.47];
const LEAN = 0.86;
const TORSO = 0.52;

const scratch = {
  root: new THREE.Vector3(), target: new THREE.Vector3(), d: new THREE.Vector3(), mid: new THREE.Vector3(),
  pole: new THREE.Vector3(), tmp: new THREE.Vector3(),
};
function ik(root: THREE.Vector3, target: THREE.Vector3, l1: number, l2: number, pole: THREE.Vector3, out: THREE.Vector3) {
  const d = scratch.d.copy(target).sub(root);
  let len = d.length();
  const max = l1 + l2 - 0.002;
  if (len > max) { d.multiplyScalar(max / len); len = max; }
  const dir = d.clone().normalize();
  const a = (l1 * l1 - l2 * l2 + len * len) / (2 * len);
  const h = Math.sqrt(Math.max(l1 * l1 - a * a, 0));
  const p = scratch.pole.copy(pole).addScaledVector(dir, -pole.dot(dir)).normalize();
  out.copy(root).addScaledVector(dir, a).addScaledVector(p, h);
}
function place(mesh: THREE.Object3D | null, a: THREE.Vector3, b: THREE.Vector3) {
  if (!mesh) return;
  const d = scratch.tmp.copy(b).sub(a);
  mesh.position.copy(a).addScaledVector(d, 0.5);
  mesh.quaternion.setFromUnitVectors(UP, d.clone().normalize());
  mesh.scale.y = d.length();
}

export function Rider({ motion, entrance, speedBoost }: {
  motion: Motion; entrance: React.MutableRefObject<number>; speedBoost: React.MutableRefObject<number>;
}) {
  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const torso = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const steer = useRef<THREE.Group>(null);
  const wheelF = useRef<THREE.Group>(null);
  const wheelR = useRef<THREE.Group>(null);
  const crank = useRef<THREE.Group>(null);
  const pedals = useRef<(THREE.Group | null)[]>([null, null]);
  const seg = useRef<Record<string, THREE.Mesh | null>>({});
  const crankAngle = useRef(0);
  const shown = useRef(0);
  const blob = useMemo(() => glowTexture("rgba(0,0,0,0.55)", "rgba(0,0,0,0)"), []);
  const pts = useMemo(() => ({
    knee: [new THREE.Vector3(), new THREE.Vector3()], foot: [new THREE.Vector3(), new THREE.Vector3()],
    elbow: [new THREE.Vector3(), new THREE.Vector3()], sh: [new THREE.Vector3(), new THREE.Vector3()],
    hip: [new THREE.Vector3(), new THREE.Vector3()], grip: [new THREE.Vector3(), new THREE.Vector3()],
  }), []);

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const t = motion.time;
    const sp = motion.speed;
    const omega = sp / WHEEL_R;
    if (wheelF.current) wheelF.current.rotation.x -= omega * dt;
    if (wheelR.current) wheelR.current.rotation.x -= omega * dt;
    crankAngle.current += omega * 0.42 * dt;
    const phi = crankAngle.current;
    const bob = Math.sin(t * 2.1 * (sp / 4.2)) * 0.006 + Math.sin(t * 9 * (sp / 4.2)) * 0.0025;
    if (body.current) {
      body.current.position.y = bob;
      body.current.rotation.z = Math.sin(t * 0.8) * 0.018;
      body.current.rotation.x = Math.sin(t * 5.5 * (sp / 4.2)) * 0.003;
    }
    if (steer.current) steer.current.rotation.y = Math.sin(t * 0.6) * 0.035;
    if (crank.current) crank.current.rotation.x = phi;
    const lean = LEAN + Math.sin(phi * 2) * 0.012 - speedBoost.current * 0.05;
    if (torso.current) torso.current.rotation.x = -lean;
    if (head.current) head.current.rotation.y = Math.sin(t * 0.45) * 0.35 * Math.max(0, Math.sin(t * 0.18));

    for (const i of [0, 1]) {
      const s = i === 0 ? -1 : 1;
      const ph = phi + i * Math.PI;
      const pedalY = BB[1] - Math.cos(ph) * CRANK, pedalZ = BB[2] - Math.sin(ph) * CRANK;
      const ped = pedals.current[i];
      if (ped) ped.position.set(s * 0.15, pedalY, pedalZ);
      const hip = pts.hip[i].set(s * 0.09, HIP[1] + bob, HIP[2]);
      const foot = pts.foot[i].set(s * 0.15, pedalY + 0.07, pedalZ - 0.02);
      ik(hip, foot, THIGH, SHIN, scratch.mid.set(s * 0.12, 0, -1), pts.knee[i]);
      const k = i === 0 ? "L" : "R";
      place(seg.current["thigh" + k], hip, pts.knee[i]);
      place(seg.current["shin" + k], pts.knee[i], foot);
      seg.current["knee" + k]?.position.copy(pts.knee[i]);
      const f = seg.current["shoe" + k];
      if (f) { f.position.set(s * 0.15, pedalY + 0.06, pedalZ - 0.04); f.rotation.x = -0.1 + Math.sin(ph) * 0.12; }
      const sh = pts.sh[i].set(s * 0.19, HIP[1] + bob + Math.cos(lean) * TORSO, HIP[2] - Math.sin(lean) * TORSO);
      const grip = pts.grip[i].set(...GRIP(s));
      ik(sh, grip, UPPER, FORE, scratch.mid.set(s * 0.8, -0.2, 0.3), pts.elbow[i]);
      place(seg.current["upper" + k], sh, pts.elbow[i]);
      place(seg.current["fore" + k], pts.elbow[i], grip);
      seg.current["elbow" + k]?.position.copy(pts.elbow[i]);
    }
    if (root.current) {
      shown.current = THREE.MathUtils.damp(shown.current, entrance.current, 2.2, dt);
      const e = 1 - Math.pow(1 - Math.min(shown.current, 1), 3);
      root.current.position.z = (1 - e) * 4.2;
      root.current.visible = shown.current > 0.01;
    }
  });
  const ref = (k: string) => (el: THREE.Mesh | null) => { seg.current[k] = el; };
  const shirt = "#eef2ee", shorts = "#1f2b3a", helmet = "#f4f7f4";
  const limb = (k: string, r0: number, r1: number, color: string) =>
    <mesh ref={ref(k)} castShadow><cylinderGeometry args={[r1, r0, 1, 12]} /><meshStandardMaterial color={color} roughness={0.7} /></mesh>;
  const ball = (k: string, r: number, color: string) =>
    <mesh ref={ref(k)} castShadow><sphereGeometry args={[r, 12, 10]} /><meshStandardMaterial color={color} roughness={0.7} /></mesh>;
  return <group ref={root}>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0.05, 0.045, 0]}>
      <planeGeometry args={[1.0, 2.1]} />
      <meshBasicMaterial map={blob} transparent depthWrite={false} opacity={0.9} polygonOffset polygonOffsetFactor={-4} />
    </mesh>
    <group ref={body}>
      <Wheel hub={[0, WHEEL_R, 0.54]} rot={wheelR} />
      <group ref={steer} position={[0, 0.62, -0.41]}>
        <group position={[0, -0.62, 0.41]}>
          <Wheel hub={[0, WHEEL_R, -0.54]} rot={wheelF} />
          <Bar a={[0.045, 0.34, -0.54]} b={[0.02, 0.64, -0.41]} r={0.014} color="#1b2326" />
          <Bar a={[-0.045, 0.34, -0.54]} b={[-0.02, 0.64, -0.41]} r={0.014} color="#1b2326" />
          <Bar a={[0, 0.64, -0.41]} b={[0, 0.86, -0.45]} r={0.02} />
          <Bar a={[0, 0.86, -0.45]} b={[0, 0.94, -0.5]} r={0.016} color="#1b2326" />
          <Bar a={[-0.3, 0.95, -0.47]} b={[0.3, 0.95, -0.47]} r={0.012} color="#1b2326" metal={0.8} />
          {[-1, 1].map(s => <mesh key={s} position={[s * 0.25, 0.95, -0.47]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.018, 0.018, 0.1, 10]} /><meshStandardMaterial color="#101415" roughness={0.9} />
          </mesh>)}
          <mesh position={[0, 0.84, -0.54]} rotation={[0.2, 0, 0]}>
            <boxGeometry args={[0.05, 0.03, 0.04]} /><meshBasicMaterial color="#fff4cf" toneMapped={false} />
          </mesh>
        </group>
      </group>
      <Bar a={[0, 0.34, 0.54]} b={BB} r={0.014} />
      <Bar a={BB} b={[0, 0.86, 0.2]} r={0.02} />
      <Bar a={[0, 0.78, 0.2]} b={[0, 0.8, -0.41]} r={0.019} />
      <Bar a={BB} b={[0, 0.65, -0.41]} r={0.024} />
      <Bar a={[0, 0.64, -0.41]} b={[0, 0.84, -0.45]} r={0.026} />
      <Bar a={[0, 0.34, 0.54]} b={[0, 0.78, 0.2]} r={0.012} />
      <Bar a={[0, 0.86, 0.2]} b={[0, 0.9, 0.2]} r={0.012} color="#1b2326" />
      <mesh position={[0, 0.915, 0.22]} castShadow>
        <boxGeometry args={[0.14, 0.04, 0.26]} /><meshStandardMaterial color="#14181a" roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.34, 0.54]} rotation={[0, 0, 0]}>
        <boxGeometry args={[0.03, 0.02, 0.03]} /><meshBasicMaterial color="#ff4a3a" toneMapped={false} />
      </mesh>
      <mesh position={[0, 0.5, 0.5]} rotation={[Math.PI / 2 - 0.45, 0, 0]}>
        <boxGeometry args={[0.07, 0.01, 0.62]} /><meshStandardMaterial color="#1f2a2e" roughness={0.5} />
      </mesh>
      <group position={BB} ref={crank}>
        <mesh rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.09, 0.09, 0.012, 24]} /><meshStandardMaterial color="#aeb9bd" metalness={0.8} roughness={0.35} />
        </mesh>
        {[0, 1].map(i => <mesh key={i} position={[(i ? 1 : -1) * 0.1, (i ? 1 : -1) * -CRANK / 2, 0]}
          rotation={[0, 0, 0]} scale={[1, 1, 1]}>
          <boxGeometry args={[0.012, CRANK, 0.02]} /><meshStandardMaterial color="#8d999e" metalness={0.8} roughness={0.3} />
        </mesh>)}
      </group>
      {[0, 1].map(i => <group key={i} ref={el => { pedals.current[i] = el; }}>
        <mesh><boxGeometry args={[0.1, 0.014, 0.1]} /><meshStandardMaterial color="#14181a" roughness={0.6} /></mesh>
      </group>)}

      {/* rider */}
      <mesh position={[0, HIP[1] - 0.02, HIP[2]]} castShadow scale={[1.1, 0.8, 0.9]}>
        <sphereGeometry args={[0.16, 16, 12]} /><meshStandardMaterial color={shorts} roughness={0.8} />
      </mesh>
      {limb("thighL", 0.082, 0.062, shorts)}{limb("thighR", 0.082, 0.062, shorts)}
      {limb("shinL", 0.058, 0.04, SKIN)}{limb("shinR", 0.058, 0.04, SKIN)}
      {ball("kneeL", 0.06, SKIN)}{ball("kneeR", 0.06, SKIN)}
      {["L", "R"].map(k => <mesh key={k} ref={ref("shoe" + k)} castShadow>
        <boxGeometry args={[0.09, 0.07, 0.25]} /><meshStandardMaterial color="#f1f3f0" roughness={0.6} />
      </mesh>)}
      <group ref={torso} position={[0, HIP[1], HIP[2]]}>
        <mesh position={[0, TORSO / 2, 0]} castShadow scale={[1.15, 1, 0.78]}>
          <capsuleGeometry args={[0.15, TORSO - 0.3, 8, 20]} /><meshStandardMaterial color={shirt} roughness={0.75} />
        </mesh>
        {[-1, 1].map(s => <mesh key={s} position={[s * 0.19, TORSO - 0.02, 0]} castShadow>
          <sphereGeometry args={[0.075, 14, 10]} /><meshStandardMaterial color={shirt} roughness={0.75} />
        </mesh>)}
        <RoundedBox args={[0.34, 0.44, 0.2]} radius={0.07} smoothness={4} position={[0, TORSO * 0.55, 0.18]} castShadow>
          <meshStandardMaterial color="#2b3a40" roughness={0.65} />
        </RoundedBox>
        <mesh position={[0, TORSO * 0.55, 0.285]}>
          <boxGeometry args={[0.2, 0.04, 0.01]} /><meshBasicMaterial color="#9dfbd3" toneMapped={false} />
        </mesh>
        <mesh position={[0, TORSO + 0.07, -0.01]} castShadow>
          <cylinderGeometry args={[0.045, 0.055, 0.1, 10]} /><meshStandardMaterial color={SKIN} roughness={0.7} />
        </mesh>
        <group ref={head} position={[0, TORSO + 0.2, -0.04]} rotation={[0.72, 0, 0]}>
          <mesh castShadow scale={[1, 1.12, 1.05]}>
            <sphereGeometry args={[0.085, 18, 14]} /><meshStandardMaterial color={SKIN} roughness={0.65} />
          </mesh>
          <mesh position={[0, 0.03, 0.012]} castShadow scale={[1.0, 0.82, 1.18]}>
            <sphereGeometry args={[0.108, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.56]} />
            <meshStandardMaterial color={helmet} roughness={0.35} metalness={0.1} />
          </mesh>
          <mesh position={[0, 0.058, 0.01]} scale={[0.14, 0.7, 1.25]}>
            <sphereGeometry args={[0.108, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.5]} />
            <meshStandardMaterial color={FRAME} roughness={0.4} />
          </mesh>
          {[-1, 1].map(s => <mesh key={s} position={[s * 0.088, -0.01, 0.0]} scale={[0.4, 1, 0.8]}>
            <sphereGeometry args={[0.025, 8, 6]} /><meshStandardMaterial color={SKIN} roughness={0.7} />
          </mesh>)}
        </group>
      </group>
      {limb("upperL", 0.056, 0.045, shirt)}{limb("upperR", 0.056, 0.045, shirt)}
      {limb("foreL", 0.042, 0.034, SKIN)}{limb("foreR", 0.042, 0.034, SKIN)}
      {ball("elbowL", 0.046, SKIN)}{ball("elbowR", 0.046, SKIN)}
    </group>
  </group>;
}
