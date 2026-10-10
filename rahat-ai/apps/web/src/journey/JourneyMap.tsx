import { HEAT_COLOR } from "./jtypes";
import type { JMap, JPOI, JRoute, JSegment, RouteId } from "./jtypes";

export interface MapLayers { thermal: boolean; shade: boolean; relief: boolean; alternatives: boolean }
export interface Pos { x: number; y: number }

const PAD = 60;
export const POI_COLOR: Record<string, string> = {
  WATER: "#5cc3ef", SHADE: "#7fd59a", REST: "#c8a6f0", COOLING: "#9fd8ff",
  "PUBLIC FACILITY": "#d6d6d6", HOSPITAL: "#ff8f8f", PARK: "#62c27a",
  TRANSIT: "#ffd36a", "OTHER RELIEF": "#f0b27a",
};

interface Props {
  map: JMap; routes: JRoute[]; selected: RouteId; layers: MapLayers;
  pois: JPOI[]; waypoints: number[]; origin: number; destination: number;
  position?: Pos | null; pick?: boolean; highlight?: string | null;
  focusSegment?: { route: RouteId; index: number } | null;
  onNode?: (id: number) => void; onSegment?: (route: JRoute, index: number) => void;
  onPOI?: (poi: JPOI) => void; closed?: string[]; label?: string;
}

export default function JourneyMap({
  map, routes, selected, layers, pois, waypoints, origin, destination, position,
  pick, highlight, focusSegment, onNode, onSegment, onPOI, closed = [], label,
}: Props) {
  const W = map.width + PAD * 2, H = map.height + PAD * 2;
  const px = (x: number) => x + PAD;
  const py = (y: number) => map.height - y + PAD;
  const node = (id: number) => map.nodes[id];
  const route = routes.find(r => r.id === selected) ?? routes[0];
  const corridorIds = new Set(route.corridor.stages.map(s => s.poi));
  return <svg className="jmap" viewBox={`0 0 ${W} ${H}`} role="img"
    aria-label={label ?? "Route map. DEMO DATA. Schematic geometry, not surveyed roads."}
    preserveAspectRatio="xMidYMid meet">
    <defs>
      <filter id="glow"><feGaussianBlur stdDeviation="5" /></filter>
      <pattern id="hatch" width="8" height="8" patternUnits="userSpaceOnUse"
        patternTransform="rotate(45)">
        <rect width="3" height="8" fill="#ffffff" opacity=".05" />
      </pattern>
    </defs>
    <rect width={W} height={H} fill="#0c1a1f" />
    <rect width={W} height={H} fill="url(#hatch)" />
    {map.buildings.map(b => <rect key={b.id} x={px(b.x)} y={py(b.y + b.d)} width={b.w} height={b.d}
      rx="4" fill={`hsl(200 14% ${14 + b.h / 6}%)`} opacity=".9" />)}
    {layers.shade && map.trees.map((t, i) => <circle key={i} cx={px(t.x)} cy={py(t.y)} r={t.r}
      fill="#2f8f5f" opacity=".28" />)}
    {map.edges.map(([a, b]) => <line key={`${a}-${b}`} x1={px(node(a).x)} y1={py(node(a).y)}
      x2={px(node(b).x)} y2={py(node(b).y)} stroke="#2c4651" strokeWidth="9" strokeLinecap="round" />)}
    {layers.alternatives && routes.filter(r => r.id !== selected).map(r =>
      <polyline key={r.id} fill="none" stroke={r.id === "fastest" ? "#8fa4ad" : "#6aa3b8"}
        strokeWidth="3.5" strokeDasharray={r.id === "fastest" ? "2 8" : "10 8"} opacity=".55"
        strokeLinecap="round" strokeLinejoin="round"
        points={r.nodes.map(n => `${px(node(n).x)},${py(node(n).y)}`).join(" ")} />)}
    <polyline fill="none" stroke="#0a1418" strokeWidth="19" strokeLinecap="round" strokeLinejoin="round"
      points={route.nodes.map(n => `${px(node(n).x)},${py(node(n).y)}`).join(" ")} />
    {route.segments.map((s: JSegment, i) => {
      const a = node(s.a), b = node(s.b);
      const focus = focusSegment && focusSegment.route === route.id && focusSegment.index === i;
      const color = layers.thermal ? HEAT_COLOR[s.heat_class] : "#9be8c8";
      return <g key={i}>
        {focus && <line x1={px(a.x)} y1={py(a.y)} x2={px(b.x)} y2={py(b.y)} stroke="#fff"
          strokeWidth="22" strokeLinecap="round" opacity=".22" />}
        <line x1={px(a.x)} y1={py(a.y)} x2={px(b.x)} y2={py(b.y)} stroke={color}
          strokeWidth="11" strokeLinecap="round" />
        <line className="hit" x1={px(a.x)} y1={py(a.y)} x2={px(b.x)} y2={py(b.y)}
          stroke="transparent" strokeWidth="30" strokeLinecap="round" tabIndex={onSegment ? 0 : -1}
          role="button" aria-label={`Segment ${i + 1}, ${s.heat_class} thermal load`}
          onClick={() => onSegment?.(route, i)}
          onKeyDown={e => { if (e.key === "Enter") onSegment?.(route, i); }} />
      </g>;
    })}
    {layers.relief && route.corridor.stages.length > 1 && <polyline className="corridor" fill="none"
      stroke="#d9fff0" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
      points={route.nodes.map(n => `${px(node(n).x)},${py(node(n).y)}`).join(" ")} />}
    {layers.relief && pois.map(p => {
      const n = node(p.node), isClosed = closed.includes(p.id);
      const on = corridorIds.has(p.id);
      const c = POI_COLOR[p.type] ?? "#ccc";
      return <g key={p.id} transform={`translate(${px(n.x)},${py(n.y)})`} className={on ? "relief on" : "relief"}
        opacity={isClosed ? 0.35 : 1} role="button" tabIndex={0} aria-label={`${p.name}, ${p.type}, DEMO DATA`}
        onClick={() => onPOI?.(p)} onKeyDown={e => { if (e.key === "Enter") onPOI?.(p); }}>
        {on && <circle r="26" fill={c} opacity=".22" className="pulse" />}
        <circle r="13" fill="#071014" stroke={highlight === p.id ? "#fff" : c} strokeWidth="3.5" />
        <text textAnchor="middle" y="5" fontSize="13" fontWeight="800" fill={c}>
          {p.type === "WATER" ? "W" : p.type === "COOLING" ? "C" : p.type === "REST" ? "R"
            : p.type === "SHADE" ? "S" : p.type === "HOSPITAL" ? "+" : p.type === "PARK" ? "P"
            : p.type === "TRANSIT" ? "T" : "•"}
        </text>
      </g>;
    })}
    {pick && map.nodes.map(n => <circle key={n.id} cx={px(n.x)} cy={py(n.y)} r="15" fill="#fff"
      opacity="0.001" className="pick" tabIndex={0} role="button"
      aria-label={`Select ${n.name}`} onClick={() => onNode?.(n.id)}
      onKeyDown={e => { if (e.key === "Enter") onNode?.(n.id); }} />)}
    {pick && map.nodes.map(n => <circle key={`d${n.id}`} cx={px(n.x)} cy={py(n.y)} r="3.4"
      fill="#8ea2aa" pointerEvents="none" />)}
    {waypoints.map((w, i) => <g key={w + "-" + i} transform={`translate(${px(node(w).x)},${py(node(w).y)})`}>
      <circle r="15" fill="#f2c23a" stroke="#071014" strokeWidth="3" />
      <text textAnchor="middle" y="5" fontSize="14" fontWeight="800" fill="#071014">{i + 1}</text>
    </g>)}
    <g transform={`translate(${px(node(origin).x)},${py(node(origin).y)})`}>
      <circle r="17" fill="#fff" stroke="#071014" strokeWidth="4" />
      <circle r="7" fill="#071014" />
      <text y="-26" textAnchor="middle" fontSize="15" fontWeight="800" fill="#fff">START</text>
    </g>
    <g transform={`translate(${px(node(destination).x)},${py(node(destination).y)})`}>
      <path d="M0 -4 C-14 -26 14 -26 0 -4" fill="none" />
      <circle r="17" fill="#ee5438" stroke="#fff" strokeWidth="4" />
      <text y="6" textAnchor="middle" fontSize="16" fontWeight="800" fill="#fff">⚑</text>
      <text y="-26" textAnchor="middle" fontSize="15" fontWeight="800" fill="#fff">DESTINATION</text>
    </g>
    {position && <g transform={`translate(${px(position.x)},${py(position.y)})`}>
      <circle r="24" fill="#4aa8ff" opacity=".25" className="pulse" />
      <circle r="11" fill="#4aa8ff" stroke="#fff" strokeWidth="4" />
    </g>}
  </svg>;
}
