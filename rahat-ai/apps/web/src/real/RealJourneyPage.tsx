import { useEffect, useId, useState } from "react";
import { Badge, Card, ErrorBox, Loading, f } from "../journey/ui";
import { fitView, pathOf } from "./projection";
import { realScenario, realSearch, realReport } from "./realApi";
import type { Analysis, Evidence, SatelliteContext, Place, RealRoute, Relief, RouteId, ScenarioRow } from "./types";
import { useRealJourney } from "./useRealJourney";
import { sunAt } from "./sun";
import "./real.css";

const BADGE_OF: Record<string, string> = {
  PUBLIC_API: "PUBLIC DATA", DEMO_DATA: "DEMO DATA", MODEL_ESTIMATE: "MODEL ESTIMATE",
  COMMUNITY_REPORT: "COMMUNITY REPORT", USER_INPUT: "USER INPUT", AI_EXPLANATION: "AI EXPLANATION",
};
const HEAT_COLOR: Record<string, string> = { LOW: "#35d6a0", MODERATE: "#f5c542", ELEVATED: "#ff8a3d", HIGH: "#ff4d4d" };
const pct = (v: number) => `${f(v * 100, 0)}%`;
const km = (m: number) => `${f(m / 1000, 2)} km`;
const time = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "n/a");

export function SourceBadge({ type }: { type: string }) { return <Badge kind={BADGE_OF[type] ?? "DEMO DATA"} />; }

function DestSearch({ onPick, bias }: { onPick: (p: Place) => void; bias?: { lat: number; lon: number } }) {
  const id = useId();
  const [q, setQ] = useState(""); const [items, setItems] = useState<Place[]>([]); const [err, setErr] = useState("");
  useEffect(() => {
    if (q.trim().length < 2) { setItems([]); return; }
    const c = new AbortController();
    const t = setTimeout(() => {
      realSearch(q, bias, c.signal).then(r => { setItems(r.items); setErr(""); })
        .catch(e => { if (e.name !== "AbortError") setErr("Search is unavailable right now."); });
    }, 350);
    return () => { clearTimeout(t); c.abort(); };
  }, [q, bias]);
  return <div className="rj-search">
    <label htmlFor={id}>DESTINATION</label>
    <input id={id} value={q} onChange={e => setQ(e.target.value)} placeholder="Search a place…" autoComplete="off" />
    {err && <p className="rj-note" role="alert">{err}</p>}
    {items.length > 0 && <ul role="listbox" aria-label="Destination suggestions">
      {items.map(p => <li key={`${p.name}${p.lat}`} role="option" aria-selected="false">
        <button type="button" onClick={() => { onPick(p); setQ(""); setItems([]); }}>
          <b>{p.name}</b><small>{p.label}</small><SourceBadge type={p.sourceType} /></button></li>)}
    </ul>}
  </div>;
}

function RouteMap({ a, chosen, here, relief }: { a: Analysis; chosen: RouteId; here: { lat: number; lon: number } | null; relief: Relief[] }) {
  const pts = a.routes.flatMap(r => r.coords.map(([lat, lon]) => ({ lat, lon })));
  const v = fitView(pts);
  const sel = a.routes.find(r => r.id === chosen)!;
  const COL: Record<RouteId, string> = { fastest: "#9aa6b2", balanced: "#f5c542", rahat: "#35d6a0" };
  const start = sel.coords[0], end = sel.coords[sel.coords.length - 1];
  return <svg className="rj-map" viewBox={`0 0 ${v.w} ${v.h}`} role="img"
    aria-label="Route map. Schematic projection of real or demo route geometry.">
    {a.routes.filter(r => r.id !== chosen).map(r => <path key={r.id} d={pathOf(v, r.coords)} stroke={COL[r.id]} strokeWidth="2" fill="none" opacity=".4" strokeDasharray="5 5" />)}
    {sel.segments.map((s, i) => <path key={i} d={pathOf(v, [s.start, s.end])} stroke={HEAT_COLOR[s.class]} strokeWidth="5" fill="none" strokeLinecap="round" />)}
    {relief.slice(0, 12).map(r => { const [x, y] = v.project(r.latitude, r.longitude);
      return <circle key={r.id} cx={x} cy={y} r="5" fill="#4aa8ff" opacity={r.availability === "REPORTED_UNAVAILABLE" ? 0.25 : 0.9}><title>{`${r.type}: ${r.name} (${r.sourceType === "DEMO_DATA" ? "DEMO DATA" : "mapped, not verified open"})`}</title></circle>; })}
    <circle cx={v.project(start[0], start[1])[0]} cy={v.project(start[0], start[1])[1]} r="7" fill="#fff" />
    <circle cx={v.project(end[0], end[1])[0]} cy={v.project(end[0], end[1])[1]} r="7" fill="#ff8a3d" />
    {here && <circle cx={v.project(here.lat, here.lon)[0]} cy={v.project(here.lat, here.lon)[1]} r="9" fill="none" stroke="#fff" strokeWidth="3" />}
  </svg>;
}

function Comparison({ routes, chosen, onChoose, a }: { routes: RealRoute[]; chosen: RouteId; onChoose: (id: RouteId) => void; a: Analysis }) {
  const lst = a.evidence.surfaceTemperature;
  return <div className="rj-compare" role="table" aria-label="Route comparison">
    {routes.map(r => <button key={r.id} type="button" className={`rj-route ${r.id} ${chosen === r.id ? "on" : ""}`}
      aria-pressed={chosen === r.id} onClick={() => onChoose(r.id)}>
      <span className="eyebrow">{r.label}</span>
      <b>{f(r.minutes, 0)} min</b>
      <dl>
        <div><dt>Distance</dt><dd>{km(r.distanceM)}{r.id !== "fastest" && ` (${r.deltaVsFastest.detourPct >= 0 ? "+" : ""}${f(r.deltaVsFastest.detourPct, 0)}%)`}</dd></div>
        <div><dt>Thermal load</dt><dd>{f(r.thermalLoad, 1)} u{r.id !== "fastest" && ` (${r.deltaVsFastest.thermalLoadPct > 0 ? "+" : ""}${f(r.deltaVsFastest.thermalLoadPct, 0)}%)`}</dd></div>
        <div><dt>Estimated shade</dt><dd>{pct(r.estimatedShade)} · {r.shadeConfidence}</dd></div>
        <div><dt>Surface temp context</dt><dd>{lst.freshness === "UNKNOWN" ? "Unavailable" : `Landsat ${lst.freshness.toLowerCase()}`}</dd></div>
        <div><dt>Relief on route</dt><dd>{r.reliefCount} mapped</dd></div>
        <div><dt>Data</dt><dd><SourceBadge type={r.sourceType} /> <Badge kind="MODEL ESTIMATE" /></dd></div>
      </dl>
      {r.headline && <em className="rj-win">{r.headline}</em>}
      {r.sameAs.length > 0 && <small>Same path as {r.sameAs.join(", ").toUpperCase()}</small>}
    </button>)}
  </div>;
}

const fx = (v: number | null | undefined, d = 2, unit = "") => (v === null || v === undefined ? "NOT AVAILABLE" : `${v.toFixed(d)}${unit}`);

function SatellitePanel({ ctx }: { ctx?: SatelliteContext }) {
  const s2 = ctx?.sentinel2, l8 = ctx?.landsat;
  return <div className="rj-evidence">
    <div className="rj-ev"><header><b>VEGETATION EVIDENCE</b><Badge kind="PUBLIC DATA" /></header>
      <dl><div><dt>Source</dt><dd>Sentinel-2 L2A · OBSERVED SATELLITE DATA</dd></div>
        <div><dt>Mean NDVI</dt><dd>{fx(s2?.meanNdvi)}</dd></div>
        <div><dt>Vegetation fraction</dt><dd>{s2?.vegetationFraction == null ? "NOT AVAILABLE" : `${Math.round(s2.vegetationFraction * 100)}%`}</dd></div>
        <div><dt>Acquired</dt><dd>{s2 ? `${new Date(s2.acquisitionDate).toLocaleDateString()} · SATELLITE DATA AGE: ${s2.ageDays} DAYS · ${s2.freshness}` : "UNAVAILABLE"}</dd></div></dl>
      <p className="rj-note">Green-cover context only. Not street-level shade and not real time.</p></div>
    <div className="rj-ev"><header><b>SURFACE TEMPERATURE EVIDENCE</b><Badge kind="PUBLIC DATA" /></header>
      <dl><div><dt>Source</dt><dd>Landsat C2 L2 · OBSERVED SURFACE TEMPERATURE</dd></div>
        <div><dt>Mean surface temp</dt><dd>{fx(l8?.surfaceTemperatureC, 1, " °C")}</dd></div>
        <div><dt>Acquired</dt><dd>{l8 ? `${new Date(l8.acquisitionDate).toLocaleDateString()} · SATELLITE DATA AGE: ${l8.ageDays} DAYS · ${l8.freshness}` : "UNAVAILABLE"}</dd></div>
        <div><dt>Score weight</dt><dd>{l8 ? `${Math.round(l8.weight * 100)}%` : "0%"}</dd></div></dl>
      <p className="rj-note">Surface temperature at overpass time. Not air temperature, not body temperature, not medical.</p></div>
  </div>;
}

function EvidenceList({ ev }: { ev: Record<string, Evidence> }) {
  return <div className="rj-evidence">{Object.values(ev).map(e => <div key={e.key} className="rj-ev">
    <header><b>{e.key.toUpperCase()}</b><Badge kind={e.badge} /></header>
    <dl><div><dt>Source</dt><dd>{e.source}</dd></div><div><dt>Freshness</dt><dd>{e.freshness}</dd></div>
      <div><dt>Confidence</dt><dd>{e.confidence}</dd></div><div><dt>Observed</dt><dd>{e.observedAt ? new Date(e.observedAt).toLocaleString() : "n/a"}</dd></div></dl>
    {e.stale && <p className="rj-warn">Stale scene: treat as historical context.</p>}
    {e.note && <p className="rj-warn">{e.note}</p>}
    <p className="rj-note">{e.limitations}</p></div>)}</div>;
}

function Scenario({ a, origin, dest }: { a: Analysis; origin: { lat: number; lon: number }; dest: Place }) {
  const [rows, setRows] = useState<ScenarioRow[] | null>(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const run = (sc: Parameters<typeof realScenario>[3]) => {
    setBusy(true); setErr("");
    realScenario(origin, dest, sunAt(origin.lat, origin.lon), sc).then(r => setRows(r.ok ? r.rows : null))
      .catch(() => setErr("Scenario unavailable.")).finally(() => setBusy(false));
  };
  return <Card title="Scenario Lab · real engine" tag="MODEL ESTIMATE">
    <div className="row rj-scn">
      <button disabled={busy} onClick={() => run({ tempOffsetC: 3 })}>Temperature +3°C</button>
      <button disabled={busy} onClick={() => run({ shadeRemoved: true })}>Shade removed</button>
      <button disabled={busy} onClick={() => run({ delayMin: 10 })}>Traffic delay +10 min</button>
      <button disabled={busy} onClick={() => run({ waterUnavailable: true })}>Water unavailable</button>
      <button disabled={busy} onClick={() => run({ cloudPct: 80 })}>Cloud cover 80%</button>
    </div>
    {err && <p className="rj-warn">{err}</p>}
    {rows && <table className="rj-table"><thead><tr><th>Route</th><th>Duration before → after</th><th>Shade</th><th>Thermal load</th><th>Relief</th></tr></thead>
      <tbody>{rows.map(r => <tr key={r.id}><td>{r.id.toUpperCase()}{r.routeChanged && " · path changed"}</td>
        <td>{f(r.before.minutes, 0)} → {f(r.after.minutes, 0)} min</td><td>{pct(r.before.estimatedShade)} → {pct(r.after.estimatedShade)}</td>
        <td>{f(r.before.thermalLoad, 1)} → {f(r.after.thermalLoad, 1)} u</td><td>{r.reliefBefore} → {r.reliefAfter}</td></tr>)}</tbody></table>}
    <p className="rj-note">{a.disclaimer}</p>
  </Card>;
}

export default function RealJourneyPage() {
  const j = useRealJourney();
  const a = j.analysis;
  const reportHere = (kind: string) => { if (j.origin) { j.setDbSaved(false); realReport(kind, j.origin.point).then(() => j.setDbSaved(true)).catch(() => undefined); } };
  return <div className="rj">
    <header className="rj-head">
      <p className="eyebrow">REAL-DATA JOURNEY</p>
      <h1>Navigate through the heat</h1>
      <div className="rj-badges">
        <Badge kind={j.status?.mode === "REAL" ? "PUBLIC DATA" : "DEMO DATA"} />
        {a && <span className={`rj-mode ${a.dataMode === "REAL DATA" ? "real" : "demo"}`}>{a.dataMode}</span>}
        {j.live && <span className={`rj-mode ${j.live.mode === "LIVE GPS" ? "real" : "demo"}`}>{j.live.mode}</span>}
      </div>
    </header>

    <Card title="1 · Your location" tag={j.origin ? (j.origin.kind === "LIVE GPS" ? "USER INPUT" : "DEMO DATA") : undefined}>
      {!j.origin ? <div className="row">
        <button className="primary" onClick={() => void j.acquire()}>Allow location (GPS)</button>
        <button onClick={j.useDemoStart}>Use demo start (Connaught Place)</button>
      </div> : <p><b>{j.origin.kind}</b> · {j.origin.label}{j.origin.accuracy != null && ` · ±${f(j.origin.accuracy, 0)} m`}</p>}
      {j.gpsMsg && <p className="rj-warn" role="status">{j.gpsMsg}</p>}
    </Card>

    {j.origin && <Card title="2 · Destination"><DestSearch onPick={j.chooseDest} bias={j.origin.point} />
      {j.dest && <p>To: <b>{j.dest.name}</b> <SourceBadge type={j.dest.sourceType} /></p>}</Card>}

    {j.busy && <Loading text="Calculating routes, weather and shade…" />}
    {j.error && <ErrorBox message={j.error} retry={j.retry} />}

    {a && j.route && j.origin && j.dest && <>
      <Card title="Fastest · Balanced · RAHAT" tag="MODEL ESTIMATE">
        <p className="rj-key">The fastest route isn't always the thermally better route.</p>
        <Comparison routes={a.routes} chosen={j.chosen} onChoose={j.setChosen} a={a} />
        <RouteMap a={a} chosen={j.chosen} here={j.live?.fix ?? null} relief={j.route.reliefNear.length ? j.route.reliefNear : a.relief} />
        <div className="rj-weather">
          <span>{f(a.weather.temperatureC, 0)}°C (feels {f(a.weather.feelsLikeC, 0)}°C) · UV {f(a.weather.uvIndex, 0)} · {a.weather.condition}</span>
          <SourceBadge type={a.weather.sourceType} /><small>{a.weather.source} · updated {time(a.weather.observedAt)}</small>
          <span>Sun {f(a.sun.elevation, 0)}° up · {a.sun.source}</span>
        </div>
        <div className="rj-why">
          {j.route.why.increasedBy.length > 0 && <p><b>Thermal load increased by:</b> {j.route.why.increasedBy.join(", ")}.</p>}
          {j.route.why.reducedBy.length > 0 && <p><b>Reduced by:</b> {j.route.why.reducedBy.join(", ")}.</p>}
          {j.explain && <p><Badge kind={j.explain.source === "AI EXPLANATION" ? "AI EXPLANATION" : "MODEL ESTIMATE"} /> {j.explain.text} {j.explain.source === "AI EXPLANATION" && <span style={{fontSize: "11px", color: "#888", display: "inline-block", marginLeft: "6px"}}>— Powered by Amazon Bedrock</span>}</p>}
        </div>
        <div className="row">
          {!j.live ? <button className="primary" onClick={j.startLive}>Start {j.origin.kind === "LIVE GPS" ? "LIVE GPS" : "DEMO"} journey</button>
            : <button onClick={j.stopLive}>End journey</button>}
          <button className="rj-need" onClick={() => void j.needRahat()} disabled={!j.live}>I NEED RAHAT</button>
        </div>
      </Card>

      {j.live && <Card title={`Live journey · ${j.live.mode}`} tag={j.live.mode === "LIVE GPS" ? "USER INPUT" : "DEMO DATA"}>
        <p>Estimated cumulative exposure: <b>{f(j.live.exposure.cumulative, 1)} u</b>
          {j.live.last && <> · segment {j.live.last.heatContext} · {f(j.live.last.progressPct, 0)}% along route</>}</p>
        {j.live.fix && <p className="rj-note">Fix ±{f(j.live.fix.accuracy, 0)} m{j.live.fix.speed != null && ` · ${f(j.live.fix.speed * 3.6, 0)} km/h`}</p>}
        {j.live.exposure.history.slice(-1).map((h, i) => <p key={i} className="rj-note">{h.why.join(" · ")}</p>)}
        {j.live.triggers.length > 0 && <div className="rj-warn" role="status"><b>Reassessment suggested:</b> {j.live.triggers.join("; ")}.</div>}
        {j.live.stopMsg && <p className="rj-warn">{j.live.stopMsg}</p>}
        {j.live.last && j.live.last.relief.length > 0 && <>
          <h3>Nearby relief</h3>
          <ul className="rj-relief">{j.live.last.relief.slice(0, 6).map(r => <li key={r.id}>
            <b>{r.type}</b> {r.name} · {r.distanceMeters} m <SourceBadge type={r.sourceType} />
            <small>{r.status} · {r.availability} · confidence {r.confidence}{r.note ? ` · ${r.note}` : ""}{r.reportNote ? ` · ${r.reportNote}` : ""}</small>
            <button type="button" disabled={r.availability === "REPORTED_UNAVAILABLE" || j.busy} onClick={() => void j.takeRelief(r)}>Route me here, then continue</button>
          </li>)}</ul></>}
      </Card>}

      <Scenario a={a} origin={j.origin.point} dest={j.dest} />
      <Card title="Community" tag="COMMUNITY REPORT">
        {j.dbSaved && <p style={{fontSize: "11px", color: "#888", marginTop: "8px", marginBottom: "8px"}}>Saved to Amazon DynamoDB</p>}
        {j.dbSaved && <p style={{fontSize: "11px", color: "#888", marginTop: "8px", marginBottom: "8px"}}>Saved to Amazon DynamoDB</p>}
        <p className="rj-note">Reports stay UNVERIFIED until independently confirmed. They are never treated as authoritative.</p>
        <div className="row">{["WATER HERE", "SHADE HERE", "COOLING HERE", "REST POINT", "NO WATER", "SHADE REMOVED", "STATION CLOSED"].map(k =>
          <button key={k} onClick={() => reportHere(k)}>{k}</button>)}</div>
      </Card>
      <Card title="Evidence" tag={a.dataMode === "REAL DATA" ? "PUBLIC DATA" : "DEMO DATA"}><EvidenceList ev={a.evidence} /><SatellitePanel ctx={a.satelliteContext} />
        {a.modelConfidence && <p className="rj-note">Model confidence: {a.modelConfidence.level}{a.modelConfidence.reasons.length > 0 && ` · ${a.modelConfidence.reasons.join("; ")}`}</p>}<div style={{marginTop: "16px"}}><button onClick={() => j.saveSnapshot(a)} disabled={j.s3Saved} style={{fontSize: "11px"}}>{j.s3Saved ? "Stored in Amazon S3" : "Archive Snapshot to S3"}</button></div><div style={{marginTop: "16px"}}><button onClick={() => j.saveSnapshot(a)} disabled={j.s3Saved} style={{fontSize: "11px"}}>{j.s3Saved ? "Stored in Amazon S3" : "Archive Snapshot to S3"}</button></div></Card>
    </>}
  </div>;
}
