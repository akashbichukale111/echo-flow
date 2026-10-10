import { useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Html, Line, OrbitControls } from "@react-three/drei";
import type { Mesh } from "three";
import type { Echo, GraphNode, SystemGraph } from "./types";

const color = (kind: string) =>
  kind === "hospital" ? "#ffbc75" : kind === "zone" || kind === "water" ? "#58bfff"
  : kind === "buffer" ? "#72e0bc" : "#c4cee0";

function position(n: GraphNode): [number, number, number] {
  return [n.x / 300, 0.15, n.y / 300];
}

function Pulse({ from, to, reduced }: { from: GraphNode; to: GraphNode; reduced: boolean }) {
  const ref = useRef<Mesh>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = reduced ? 0.5 : (clock.elapsedTime * 0.35) % 1;
    ref.current.position.set((from.x + (to.x - from.x) * t) / 300, 0.18, (from.y + (to.y - from.y) * t) / 300);
  });
  return (
    <mesh ref={ref}>
      <sphereGeometry args={[0.035, 8, 8]} />
      <meshBasicMaterial color="#ffbc75" />
    </mesh>
  );
}

export default function Spatial({ graph, echoes, onSelect, reduced }: {
  graph: SystemGraph; echoes: Echo[]; onSelect: (n: GraphNode) => void; reduced: boolean;
}) {
  const byId = Object.fromEntries(graph.nodes.map(n => [n.id, n]));
  return (
    <Canvas
      camera={{ position: [3, 7, 8], fov: 45 }}
      dpr={[1, 1.5]}
      onCreated={({ gl }) => {
        gl.domElement.addEventListener("webglcontextlost", event => {
          event.preventDefault();
          window.dispatchEvent(new Event("echo-webgl-lost"));
        });
      }}
    >
      <ambientLight intensity={1.1} />
      <directionalLight position={[3, 6, 4]} intensity={2} />
      <gridHelper args={[14, 28, "#27394e", "#172637"]} />
      {graph.edges.map((e, i) => {
        const a = byId[e.source], b = byId[e.target];
        return a && b ? (
          <Line key={i} points={[position(a), position(b)]}
            color={e.kind === "route" ? "#55687e" : "#246578"} lineWidth={1.5} />
        ) : null;
      })}
      {graph.nodes.map(n => (
        <mesh key={n.id} position={position(n)} onClick={() => onSelect(n)}>
          <boxGeometry args={[0.18, n.kind === "hospital" ? 0.45 : 0.2, 0.18]} />
          <meshStandardMaterial color={color(n.kind)} />
          <Html distanceFactor={8} position={[0, 0.35, 0]}>
            <span className="spatial-label">{n.id}</span>
          </Html>
        </mesh>
      ))}
      {echoes.map((e, i) =>
        byId[e.source] && byId[e.target]
          ? <Pulse key={i} from={byId[e.source]} to={byId[e.target]} reduced={reduced} /> : null)}
      <OrbitControls target={[2, 0, 0]} maxPolarAngle={Math.PI / 2.05} />
    </Canvas>
  );
}
