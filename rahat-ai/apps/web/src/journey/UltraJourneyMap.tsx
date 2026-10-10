import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { HEAT_COLOR } from "./jtypes";
import type { JMap, JPOI, JRoute, JSegment, RouteId } from "./jtypes";
import { f } from "./UltraUi";

export interface MapLayers { thermal: boolean; shade: boolean; relief: boolean; alternatives: boolean }
export interface Pos { x: number; y: number }
export interface MapMarker { id: string; node: number; label: string; color: string; glyph: string; dim?: boolean }

const PAD = 60;
export const POI_COLOR: Record<string, string> = {
  WATER: "#5cc3ef", SHADE: "#7fd59a", REST: "#c8a6f0", COOLING: "#9fd8ff",
  "PUBLIC FACILITY": "#d6d6d6", HOSPITAL: "#ff8f8f", PARK: "#62c27a",
  TRANSIT: "#ffd36a", "OTHER RELIEF": "#f0b27a",
};
const GLYPH: Record<string, string> = {
  WATER: "W", COOLING: "C", REST: "R", SHADE: "S", HOSPITAL: "+", PARK: "P", TRANSIT: "T",
};

interface Box { x: number; y: number; w: number; h: number }
interface Props {
  map: JMap; routes: JRoute[]; selected: RouteId; layers: MapLayers;
  pois: JPOI[]; waypoints: number[]; origin: number; destination: number;
  position?: Pos | null; pick?: boolean; highlight?: string | null;
  focusSegment?: { route: RouteId; index: number } | null;
  onNode?: (id: number) => void; onSegment?: (route: JRoute, index: number) => void;
  onPOI?: (poi: JPOI) => void; closed?: string[]; label?: string;
  markers?: MapMarker[]; onMarker?: (m: MapMarker) => void;
  follow?: boolean; controls?: boolean; className?: string; badge?: string;
}

const prefersReduced = () => typeof window !== "undefined"
  && (!!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    || document.documentElement.dataset.motion === "reduced");

export default function JourneyMap({
  map, routes, selected, layers, pois, waypoints, origin, destination, position,
  pick, highlight, focusSegment, onNode, onSegment, onPOI, closed = [], label,
  markers = [], onMarker, follow = false, controls = true, className = "", badge = "DEMO DATA · SCHEMATIC",
}: Props) {
  const W = map.width + PAD * 2, H = map.height + PAD * 2;
  const px = (x: number) => x + PAD;
  const py = (y: number) => map.height - y + PAD;
  const node = (id: number) => map.nodes[id];
  const route = routes.find(r => r.id === selected) ?? routes[0] ?? null;
  const corridorIds = new Set(route ? route.corridor.stages.map(s => s.poi) : []);
  const ptsOf = (r: JRoute) => r.nodes.map(n => `${px(node(n).x)},${py(node(n).y)}`).join(" ");
  const routeKey = route ? `${route.id}:${route.nodes.join("-")}` : "none";
  const [hov, setHov] = useState<number | null>(null);

  /* reroute: old path fades while the new one draws in */
  const prev = useRef<{ key: string; pts: string } | null>(null);
  const [ghost, setGhost] = useState<string | null>(null);
  useEffect(() => {
    const cur = route ? { key: routeKey, pts: ptsOf(route) } : null;
    const old = prev.current;
    prev.current = cur;
    if (old && cur && old.key !== cur.key && old.pts !== cur.pts) {
      setGhost(old.pts);
      const t = setTimeout(() => setGhost(null), 1000);
      return () => clearTimeout(t);
    }
  }, [routeKey]);

  /* camera: smooth zoom / follow */
  const full = useMemo<Box>(() => ({ x: 0, y: 0, w: W, h: H }), [W, H]);
  const [target, setTarget] = useState<Box | null>(null);
  const [box, setBox] = useState<Box>(full);
  const boxRef = useRef<Box>(full);
  useEffect(() => { boxRef.current = box; });
  useEffect(() => {
    const goal = target ?? full;
    const from = boxRef.current;
    if (prefersReduced()) { setBox(goal); return; }
    const t0 = performance.now(); let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 420), e = 1 - Math.pow(1 - k, 3);
      setBox({ x: from.x + (goal.x - from.x) * e, y: from.y + (goal.y - from.y) * e,
        w: from.w + (goal.w - from.w) * e, h: from.h + (goal.h - from.h) * e });
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, full]);
  const clampBox = (b: Box): Box => {
    const w = Math.min(W, Math.max(W * 0.28, b.w)), h = w * (H / W);
    return { w, h, x: Math.max(0, Math.min(W - w, b.x)), y: Math.max(0, Math.min(H - h, b.y)) };
  };
  const zoom = (k: number) => {
    const b = target ?? box;
    const w = b.w * k, h = b.h * k, cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    setTarget(clampBox({ x: cx - w / 2, y: cy - h / 2, w, h }));
  };
  const posX = position ? px(position.x) : 0, posY = position ? py(position.y) : 0;
  const hasPos = !!position;
  useEffect(() => {
    if (!follow || !hasPos) return;
    const w = W * 0.5, h = H * 0.5;
    setTarget(clampBox({ x: posX - w / 2, y: posY - h / 2, w, h }));
  }, [follow, hasPos, Math.round(posX / 8), Math.round(posY / 8)]);
  useEffect(() => { if (!follow) setTarget(t => (t ? null : t)); }, [follow]);

  const hovSeg = route && hov !== null ? route.segments[hov] : null;
  const markerGlyph = (p: JPOI) => GLYPH[p.type] ?? "•";
  return <div className={`mapframe ${className}`}>
    <svg className="jmap" viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`} role="img"
      aria-label={label ?? "Route map. DEMO DATA. Schematic geometry, not surveyed roads."}
      preserveAspectRatio="xMidYMid meet">
      <defs>
        <filter id="glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="7" /></filter>
        <filter id="softglow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3.5" /></filter>
        <radialGradient id="mapbg" cx="50%" cy="45%" r="75%">
          <stop offset="0" stopColor="#10261f" /><stop offset="1" stopColor="#050d0b" />
        </radialGradient>
        <radialGradient id="vignette" cx="50%" cy="50%" r="70%">
          <stop offset=".55" stopColor="#000" stopOpacity="0" /><stop offset="1" stopColor="#000" stopOpacity=".55" />
        </radialGradient>
        <pattern id="hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="2" height="8" fill="#ffffff" opacity=".035" />
        </pattern>
      </defs>
      <rect width={W} height={H} fill="url(#mapbg)" />
      <rect width={W} height={H} fill="url(#hatch)" />
      {map.buildings.map(b => <rect key={b.id} x={px(b.x)} y={py(b.y + b.d)} width={b.w} height={b.d}
        rx="4" fill={`hsl(165 ${12 + b.h / 8}% ${10 + b.h / 7}%)`} stroke="#ffffff" strokeOpacity=".05" opacity=".95" />)}
      {layers.shade && map.trees.map((t, i) => <circle key={i} cx={px(t.x)} cy={py(t.y)} r={t.r}
        fill="#3bbf86" opacity=".2" />)}
      {map.edges.map(([a, b]) => <line key={`${a}-${b}`} x1={px(node(a).x)} y1={py(node(a).y)}
        x2={px(node(b).x)} y2={py(node(b).y)} stroke="#1f3a36" strokeWidth="10" strokeLinecap="round" />)}
      {map.edges.map(([a, b]) => <line key={`c${a}-${b}`} x1={px(node(a).x)} y1={py(node(a).y)}
        x2={px(node(b).x)} y2={py(node(b).y)} stroke="#2f5249" strokeWidth="1.5" strokeDasharray="3 9" strokeLinecap="round" />)}
      {layers.alternatives && routes.filter(r => r.id !== selected).map(r =>
        <polyline key={r.id} fill="none" stroke={r.id === "fastest" ? "#9db3ab" : "#6fd8ff"}
          strokeWidth="3.5" strokeDasharray={r.id === "fastest" ? "2 8" : "10 8"} opacity=".5"
          strokeLinecap="round" strokeLinejoin="round" points={ptsOf(r)} />)}
      {ghost && <polyline className="route-ghost" fill="none" stroke="#9be8c8" strokeWidth="9" strokeLinecap="round"
        strokeLinejoin="round" points={ghost} />}
      {route && <g key={routeKey}>
        <polyline className="route-halo" fill="none" stroke="#7df0c0" strokeWidth="26" strokeLinecap="round"
          strokeLinejoin="round" filter="url(#glow)" points={ptsOf(route)} />
        <polyline fill="none" stroke="#04100d" strokeWidth="21" strokeLinecap="round" strokeLinejoin="round"
          points={ptsOf(route)} />
        {route.segments.map((s: JSegment, i) => {
          const a = node(s.a), b = node(s.b);
          const x1 = px(a.x), y1 = py(a.y), x2 = px(b.x), y2 = py(b.y);
          const len = Math.hypot(x2 - x1, y2 - y1);
          const focus = focusSegment && focusSegment.route === route.id && focusSegment.index === i;
          const color = layers.thermal ? HEAT_COLOR[s.heat_class] : "#9be8c8";
          const style = { "--len": len, animationDelay: `${i * 70}ms` } as CSSProperties;
          return <g key={i}>
            {(focus || hov === i) && <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#fff"
              strokeWidth="25" strokeLinecap="round" opacity={focus ? 0.28 : 0.16} />}
            <line className="draw" style={style} x1={x1} y1={y1} x2={x2} y2={y2} stroke={color}
              strokeWidth={hov === i || focus ? 13 : 11} strokeLinecap="round" />
            <line className="hit" x1={x1} y1={y1} x2={x2} y2={y2}
              stroke="transparent" strokeWidth="32" strokeLinecap="round" tabIndex={onSegment ? 0 : -1}
              role="button" aria-label={`Segment ${i + 1}, ${s.heat_class} thermal load`}
              onMouseEnter={() => setHov(i)} onMouseLeave={() => setHov(null)}
              onFocus={() => setHov(i)} onBlur={() => setHov(null)}
              onClick={() => onSegment?.(route, i)}
              onKeyDown={e => { if (e.key === "Enter") onSegment?.(route, i); }} />
          </g>;
        })}
        {layers.relief && route.corridor.stages.length > 1 && <polyline className="corridor" fill="none"
          stroke="#e4fff3" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" points={ptsOf(route)} />}
      </g>}
      {layers.relief && pois.map(p => {
        const n = node(p.node), isClosed = closed.includes(p.id);
        const on = corridorIds.has(p.id), hi = highlight === p.id;
        const c = POI_COLOR[p.type] ?? "#ccc";
        return <g key={p.id} transform={`translate(${px(n.x)},${py(n.y)})`}
          className={`relief ${on ? "on" : ""} ${hi ? "hi" : ""}`}
          opacity={isClosed ? 0.35 : 1} role="button" tabIndex={0} aria-label={`${p.name}, ${p.type}, DEMO DATA`}
          onClick={() => onPOI?.(p)} onKeyDown={e => { if (e.key === "Enter") onPOI?.(p); }}>
          <title>{p.name} · {p.type}</title>
          {(on || hi) && <circle r="28" fill={c} opacity=".2" className="pulse" />}
          <g className="pin">
            <circle r="17" fill={c} opacity=".16" />
            <circle r="13" fill="#06120f" stroke={hi ? "#fff" : c} strokeWidth="3" />
            <text textAnchor="middle" y="5" fontSize="13" fontWeight="800" fill={c}>{markerGlyph(p)}</text>
          </g>
        </g>;
      })}
      {markers.map(m => {
        const n = node(m.node);
        return <g key={m.id} transform={`translate(${px(n.x)},${py(n.y)})`} className="relief" opacity={m.dim ? 0.4 : 1}
          role="button" tabIndex={0} aria-label={m.label} onClick={() => onMarker?.(m)}
          onKeyDown={e => { if (e.key === "Enter") onMarker?.(m); }}>
          <title>{m.label}</title>
          <g className="pin">
            <circle r="18" fill={m.color} opacity=".18" className="pulse" />
            <circle r="12" fill="#06120f" stroke={m.color} strokeWidth="3" />
            <text textAnchor="middle" y="4.5" fontSize="12" fontWeight="800" fill={m.color}>{m.glyph}</text>
          </g>
        </g>;
      })}
      {pick && map.nodes.map(n => <circle key={n.id} cx={px(n.x)} cy={py(n.y)} r="16" fill="#fff"
        opacity="0.001" className="pick" tabIndex={0} role="button"
        aria-label={`Select ${n.name}`} onClick={() => onNode?.(n.id)}
        onKeyDown={e => { if (e.key === "Enter") onNode?.(n.id); }} />)}
      {pick && map.nodes.map(n => <circle key={`d${n.id}`} cx={px(n.x)} cy={py(n.y)} r="4"
        fill="#7df0c0" opacity=".75" pointerEvents="none" />)}
      {waypoints.map((w, i) => <g key={w + "-" + i} className="wp-pin" transform={`translate(${px(node(w).x)},${py(node(w).y)})`}>
        <circle r="22" fill="#f2c23a" opacity=".18" />
        <circle r="15" fill="#f2c23a" stroke="#06120f" strokeWidth="3" />
        <text textAnchor="middle" y="5" fontSize="14" fontWeight="800" fill="#06120f">{i + 1}</text>
      </g>)}
      <g transform={`translate(${px(node(origin).x)},${py(node(origin).y)})`}>
        <circle r="26" fill="#fff" opacity=".12" className="pulse" />
        <circle r="17" fill="#f3f8f5" stroke="#06120f" strokeWidth="4" />
        <circle r="7" fill="#06120f" />
        <g transform="translate(0,-34)"><rect x="-30" y="-12" width="60" height="22" rx="11" fill="#06120f" stroke="#ffffff" strokeOpacity=".35" />
          <text textAnchor="middle" y="3" fontSize="11" fontWeight="800" letterSpacing="1.4" fill="#fff">START</text></g>
      </g>
      <g transform={`translate(${px(node(destination).x)},${py(node(destination).y)})`}>
        <circle r="28" fill="#ff7a52" opacity=".16" className="pulse" />
        <circle r="17" fill="#ee5438" stroke="#fff" strokeWidth="4" />
        <text y="6" textAnchor="middle" fontSize="16" fontWeight="800" fill="#fff">⚑</text>
        <g transform="translate(0,-36)"><rect x="-52" y="-12" width="104" height="22" rx="11" fill="#06120f" stroke="#ff9a7a" strokeOpacity=".6" />
          <text textAnchor="middle" y="3" fontSize="11" fontWeight="800" letterSpacing="1.4" fill="#ffd2c2">DESTINATION</text></g>
      </g>
      {position && <g transform={`translate(${px(position.x)},${py(position.y)})`} className="rider-pin">
        <circle r="30" fill="#6fd8ff" opacity=".22" className="pulse" />
        <circle r="14" fill="#6fd8ff" stroke="#fff" strokeWidth="4" />
        <path d="M-5 3 L0 -6 L5 3 Z" fill="#06120f" />
      </g>}
      {hovSeg && route && (() => {
        const a = node(hovSeg.a), b = node(hovSeg.b);
        const mx = px((a.x + b.x) / 2), my = py((a.y + b.y) / 2) - 28;
        return <g transform={`translate(${mx},${my})`} pointerEvents="none">
          <rect x="-58" y="-14" width="116" height="26" rx="13" fill="#06120f" stroke={HEAT_COLOR[hovSeg.heat_class]} strokeOpacity=".8" />
          <text textAnchor="middle" y="4" fontSize="11.5" fontWeight="800" fill="#fff">{hovSeg.heat_class} · {f(hovSeg.load)} u</text>
        </g>;
      })()}
      <rect width={W} height={H} fill="url(#vignette)" pointerEvents="none" />
    </svg>
    <span className="map-badge">{badge}</span>
    {controls && <div className="mapctl" role="group" aria-label="Map camera">
      <button aria-label="Zoom in" onClick={() => zoom(0.72)}>+</button>
      <button aria-label="Zoom out" onClick={() => zoom(1.38)}>−</button>
      <button aria-label="Reset view" onClick={() => setTarget(null)}>⌂</button>
    </div>}
  </div>;
}
