import { Component, Suspense, lazy, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Echo, GraphNode, SystemGraph } from "./types";

interface Props { graph: SystemGraph; echoes: Echo[]; onSelectNode?: (id: string | null) => void }

const color = (kind: string) =>
  kind === "hospital" ? "#ffbc75" : kind === "zone" || kind === "water" ? "#58bfff"
  : kind === "buffer" ? "#72e0bc" : "#c4cee0";

// Real code splitting: Three.js lives in Spatial.tsx and is only downloaded when 3D is opened.
const LazySpatial = lazy(() => import("./Spatial"));

class GraphBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

function supportsWebGL() {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

export default function Graph({ graph, echoes, onSelectNode }: Props) {
  const [mode, setMode] = useState<"2D" | "3D">("2D");
  const [lost, setLost] = useState(false);
  const [selected, setSelectedRaw] = useState<GraphNode | null>(null);
  const setSelected = (n: GraphNode | null) => { setSelectedRaw(n); onSelectNode?.(n?.id ?? null); };
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const available = useMemo(supportsWebGL, []);
  const byId = Object.fromEntries(graph.nodes.map(n => [n.id, n]));

  useEffect(() => {
    const handle = () => { setLost(true); setMode("2D"); };
    window.addEventListener("echo-webgl-lost", handle);
    return () => window.removeEventListener("echo-webgl-lost", handle);
  }, []);

  const xs = graph.nodes.map(n => n.x);
  const ys = graph.nodes.map(n => n.y);
  const left = Math.min(...xs) - 170;
  const top = Math.min(...ys) - 170;
  const width = Math.max(...xs) - left + 170;
  const height = Math.max(...ys) - top + 170;

  const svg = (
    <svg className="system-graph" viewBox={`${left} ${top} ${width} ${height}`} role="img"
      aria-label="Synthetic system dependency graph">
      {graph.edges.map((e, i) => {
        const a = byId[e.source], b = byId[e.target];
        if (!a || !b) return null;
        const active = echoes.some(x => x.source === e.source && x.target === e.target);
        return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
          className={`${e.kind} ${active ? "propagating" : ""}`} />;
      })}
      {graph.nodes.map(n => (
        <g key={n.id} transform={`translate(${n.x},${n.y})`} role="button" tabIndex={0}
          aria-label={`${n.id}, ${n.kind}`} onClick={() => setSelected(n)}
          onKeyDown={e => { if (e.key === "Enter" || e.key === " ") setSelected(n); }}>
          <circle r={30} fill="#0e1d2d" stroke={color(n.kind)} strokeWidth={3} />
          <text y={6} textAnchor="middle" fill="#ecf4ff" fontSize={19}>{n.id}</text>
          <text y={58} textAnchor="middle" fill="#9daec2" fontSize={18}>{n.kind}</text>
        </g>
      ))}
    </svg>
  );

  return (
    <section className="graph-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">SYSTEM TOPOLOGY</span>
          <h2>Where the consequence travels</h2>
        </div>
        <div className="segmented">
          <button onClick={() => setMode("2D")} aria-pressed={mode === "2D"}>2D</button>
          <button onClick={() => setMode("3D")} disabled={!available || lost} aria-pressed={mode === "3D"}>3D</button>
        </div>
      </div>
      <div className="graph-viewport">
        {mode === "3D" && available && !lost ? (
          <GraphBoundary fallback={svg}>
            <Suspense fallback={<p>Loading spatial view…</p>}>
              <LazySpatial graph={graph} echoes={echoes} onSelect={setSelected} reduced={reduced} />
            </Suspense>
          </GraphBoundary>
        ) : svg}
      </div>
      <p className="muted">{graph.coordinate_system}</p>
      {(!available || lost) && <p>WebGL unavailable — functional 2D view active.</p>}
      <label className="node-picker">
        Inspect entity
        <select value={selected?.id ?? ""} onChange={e => setSelected(byId[e.target.value] ?? null)}>
          <option value="">Select node</option>
          {graph.nodes.map(n => <option key={n.id} value={n.id}>{n.id}</option>)}
        </select>
      </label>
      {selected && (
        <p className="node-detail">
          <strong>{selected.id}</strong> · {selected.kind} · synthetic position ({selected.x}, {selected.y}) m ·
          population {selected.population}
        </p>
      )}
    </section>
  );
}
