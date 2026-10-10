import { Canvas, useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

export type Scene = "hero" | "choice";
const LEN = 120;

function useReduced() {
  return typeof window !== "undefined"
    && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

function Wheel({ z, speed }: { z: number; speed: number }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, dt) => { if (ref.current) ref.current.rotation.x -= dt * speed * 2.2; });
  return <group position={[0, 0.42, z]}>
    <group ref={ref}>
      <mesh rotation={[0, Math.PI / 2, 0]}>
        <torusGeometry args={[0.42, 0.09, 12, 28]} />
        <meshStandardMaterial color="#10171b" roughness={0.8} />
      </mesh>
      {[0, 1, 2, 3].map(i => <mesh key={i} rotation={[(i * Math.PI) / 4, 0, 0]}>
        <boxGeometry args={[0.04, 0.8, 0.04]} />
        <meshStandardMaterial color="#9fb3bb" metalness={0.7} roughness={0.3} />
      </mesh>)}
    </group>
  </group>;
}

function Rider({ speed }: { speed: number }) {
  const body = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (body.current) {
      body.current.position.y = Math.sin(t * speed * 3) * 0.02;
      body.current.rotation.z = Math.sin(t * 0.9) * 0.015;
      body.current.rotation.x = -0.18 + Math.sin(t * speed * 2) * 0.01;
    }
  });
  return <group ref={body}>
    <Wheel z={-0.95} speed={speed} />
    <Wheel z={0.95} speed={speed} />
    <mesh position={[0, 0.78, 0]} rotation={[0.35, 0, 0]}>
      <boxGeometry args={[0.34, 0.34, 1.7]} />
      <meshStandardMaterial color="#e8542f" roughness={0.45} metalness={0.3} />
    </mesh>
    <mesh position={[0, 0.98, 0.2]}>
      <boxGeometry args={[0.3, 0.12, 0.9]} />
      <meshStandardMaterial color="#141b1f" />
    </mesh>
    <mesh position={[0, 1.18, -0.78]} rotation={[0, 0, Math.PI / 2]}>
      <cylinderGeometry args={[0.03, 0.03, 0.82, 8]} />
      <meshStandardMaterial color="#cfd9de" metalness={0.8} roughness={0.25} />
    </mesh>
    <mesh position={[0, 1.12, 0.62]}>
      <boxGeometry args={[0.62, 0.52, 0.5]} />
      <meshStandardMaterial color="#2a9d74" roughness={0.6} />
    </mesh>
    {/* rider, seen from behind, leaning toward the handlebars */}
    <group position={[0, 1.02, 0.18]} rotation={[-0.35, 0, 0]}>
      <mesh position={[0, 0.5, 0]}>
        <capsuleGeometry args={[0.2, 0.55, 6, 12]} />
        <meshStandardMaterial color="#f2c23a" roughness={0.7} />
      </mesh>
      <mesh position={[0, 1.04, -0.02]}>
        <sphereGeometry args={[0.2, 18, 14]} />
        <meshStandardMaterial color="#f4f7f8" roughness={0.35} />
      </mesh>
      <mesh position={[-0.27, 0.62, -0.28]} rotation={[0.9, 0, 0.3]}>
        <capsuleGeometry args={[0.07, 0.5, 4, 8]} />
        <meshStandardMaterial color="#f2c23a" />
      </mesh>
      <mesh position={[0.27, 0.62, -0.28]} rotation={[0.9, 0, -0.3]}>
        <capsuleGeometry args={[0.07, 0.5, 4, 8]} />
        <meshStandardMaterial color="#f2c23a" />
      </mesh>
    </group>
  </group>;
}

function Scroller({ speed, children, z0 }: { speed: number; children: React.ReactNode; z0: number }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (ref.current) ref.current.position.z = ((clock.elapsedTime * speed * 4 + z0) % LEN);
  });
  return <group ref={ref}>{children}</group>;
}

function Side({ x, hot, speed }: { x: number; hot: boolean; speed: number }) {
  const items = useMemo(() => Array.from({ length: 14 }, (_, i) => ({
    z: -i * (LEN / 14), s: 0.8 + ((i * 37) % 10) / 10,
  })), []);
  return <>
    {[0, 1].map(k => <Scroller key={k} speed={speed} z0={k * LEN - LEN}>
      {items.map((it, i) => hot
        ? <group key={i} position={[x, 0, it.z]}>
          <mesh position={[0, 2.2 * it.s + 1.4, 0]}>
            <boxGeometry args={[3, 4.4 * it.s + 2.8, 3.4]} />
            <meshStandardMaterial color={i % 3 ? "#8a7d72" : "#6f655e"} roughness={0.95} />
          </mesh>
        </group>
        : <group key={i} position={[x, 0, it.z]}>
          {i % 4 === 3
            ? <mesh position={[0, 1.2, 0]}>
              <boxGeometry args={[2.6, 2.4, 2.8]} />
              <meshStandardMaterial color="#6e8a86" />
            </mesh>
            : <>
              <mesh position={[0, 0.9, 0]}>
                <cylinderGeometry args={[0.12, 0.18, 1.8, 8]} />
                <meshStandardMaterial color="#5b4636" />
              </mesh>
              <mesh position={[0, 2.5 * it.s, 0]}>
                <sphereGeometry args={[1.3 * it.s, 14, 10]} />
                <meshStandardMaterial color="#2f8f5f" roughness={0.9} />
              </mesh>
            </>}
        </group>)}
    </Scroller>)}
  </>;
}

function Road({ speed }: { speed: number }) {
  const dashes = useMemo(() => Array.from({ length: 20 }, (_, i) => -i * (LEN / 20)), []);
  return <>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -LEN / 2]}>
      <planeGeometry args={[7, LEN * 2]} />
      <meshStandardMaterial color="#2b2f31" roughness={0.95} />
    </mesh>
    {[0, 1].map(k => <Scroller key={k} speed={speed} z0={k * LEN - LEN}>
      {dashes.map((z, i) => <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, z]}>
        <planeGeometry args={[0.12, 2]} />
        <meshStandardMaterial color="#e9e3c9" />
      </mesh>)}
    </Scroller>)}
  </>;
}

function Particles({ hot, x }: { hot: boolean; x: number }) {
  const ref = useRef<THREE.Points>(null);
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pts = new Float32Array(160 * 3);
    for (let i = 0; i < 160; i++) {
      pts[i * 3] = x + (((i * 53) % 100) / 100 - 0.5) * 12;
      pts[i * 3 + 1] = ((i * 29) % 100) / 100 * 5;
      pts[i * 3 + 2] = -(((i * 71) % 100) / 100) * 40;
    }
    g.setAttribute("position", new THREE.BufferAttribute(pts, 3));
    return g;
  }, [x]);
  useFrame(({ clock }) => {
    if (ref.current) {
      ref.current.position.y = Math.sin(clock.elapsedTime * 0.8) * (hot ? 0.35 : 0.15);
      ref.current.position.z = (clock.elapsedTime * 3) % 8;
    }
  });
  return <points ref={ref} geometry={geo}>
    <pointsMaterial size={0.08} color={hot ? "#ffb878" : "#bfffe0"} transparent opacity={0.6} />
  </points>;
}

function Rig({ go, scene }: { go: boolean; scene: Scene }) {
  const start = useRef(0);
  useFrame(({ camera, clock }) => {
    const t = clock.elapsedTime;
    if (go && !start.current) start.current = t;
    const p = go ? Math.min(1, (t - start.current) / 1.1) : 0;
    const ease = p * p * (3 - 2 * p);
    const sway = Math.sin(t * 0.5) * (scene === "hero" ? 0.25 : 0.12);
    camera.position.set(sway, 2.4 - ease * 1.1, 6.2 - ease * 5.4);
    camera.lookAt(0, 1.5, -12);
  });
  return null;
}

export default function Rider3D({
  scene = "hero", go = false,
}: { scene?: Scene; go?: boolean }) {
  const reduced = useReduced();
  const speed = reduced ? 0.25 : 1;
  const choice = scene === "choice";
  return <Canvas camera={{ position: [0, 2.4, 6.2], fov: 52 }} dpr={[1, 1.6]}
    gl={{ antialias: true }} aria-label="3D rider on a bike about to travel">
    <color attach="background" args={[choice ? "#17272c" : "#e9a15f"]} />
    <fog attach="fog" args={[choice ? "#1c3036" : "#e9b27a", 14, 70]} />
    <hemisphereLight args={["#fff3dc", "#3a3a35", 0.9]} />
    <directionalLight position={[-8, 14, 6]} intensity={choice ? 1.5 : 2.4} color="#ffe2b0" />
    <mesh position={[choice ? 0 : 6, choice ? 22 : 12, -60]}>
      <sphereGeometry args={[choice ? 4 : 5.5, 24, 16]} />
      <meshBasicMaterial color="#fff1c8" />
    </mesh>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, -LEN / 2]}>
      <planeGeometry args={[80, LEN * 2]} />
      <meshStandardMaterial color={choice ? "#324a3e" : "#a98a63"} roughness={1} />
    </mesh>
    {choice && <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-13, 0.01, -LEN / 2]}>
      <planeGeometry args={[26, LEN * 2]} />
      <meshStandardMaterial color="#8d6f4d" roughness={1} />
    </mesh>}
    {choice && <mesh rotation={[-Math.PI / 2, 0, 0]} position={[11, 0.03, -LEN / 2]}>
      <planeGeometry args={[3.2, LEN * 2]} />
      <meshStandardMaterial color="#3b88a8" transparent opacity={0.75} />
    </mesh>}
    <Road speed={speed} />
    <Side x={choice ? -6.5 : -6.5} hot={true} speed={speed} />
    <Side x={choice ? 7.5 : 6.5} hot={!choice} speed={speed} />
    {choice && <Particles hot x={-8} />}
    <Particles hot={!choice} x={choice ? 8 : 0} />
    <Rider speed={speed * (go ? 2.2 : 1)} />
    <Rig go={go} scene={scene} />
  </Canvas>;
}
