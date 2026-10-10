import { useEffect, useState } from "react";
import { request } from "./api";
import type { AuditReport, Challenge, LiveContext, ProviderResult, Provenance, Scenario } from "./types";

const cls: Record<string, string> = {
  "REAL / PUBLIC": "prov-real", SIMULATED: "prov-sim", DERIVED: "prov-derived", "AI REASONING": "prov-ai",
};

export function Prov({ label }: { label: Provenance | string }) {
  return <span className={`prov ${cls[label] ?? ""}`} title={`Data provenance: ${label}`}>{label}</span>;
}

export function StatusPill({ status }: { status: string }) {
  const tone = status === "LIVE" || status === "IMPLEMENTED" ? "ok" : status === "PARTIAL" ? "warn" : "off";
  return <span className={`pill pill-${tone}`}>{status.replace("_", " ")}</span>;
}

export function CoverageMatrix() {
  const [rows, setRows] = useState<Challenge[] | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    request<{ challenges: Challenge[] }>("/coverage").then(r => setRows(r.challenges))
      .catch(() => setErr("Coverage unavailable: API not reachable. Nothing is assumed."));
  }, []);
  if (err) return <p className="warning" role="alert">{err}</p>;
  if (!rows) return <p className="muted" role="status">Loading coverage…</p>;
  return (
    <div className="table-scroll">
      <table className="coverage">
        <caption className="sr-only">Challenge coverage and implementation status</caption>
        <thead><tr><th>#</th><th>Challenge</th><th>System</th><th>Engine</th><th>Data</th><th>Notes</th></tr></thead>
        <tbody>{rows.map(c => (
          <tr key={c.id}>
            <td>{c.id}</td><td><strong>{c.challenge}</strong></td><td>{c.system}</td>
            <td><StatusPill status={c.engine} /></td>
            <td>{c.data === "NONE" ? <span className="muted">none</span> : <Prov label={c.data} />}</td>
            <td><small>{c.note}</small></td>
          </tr>))}</tbody>
      </table>
    </div>
  );
}

function ProviderCard({ name, r }: { name: string; r: ProviderResult }) {
  return (
    <article className="provider">
      <header><h4>{name.replaceAll("_", " ")}</h4><StatusPill status={r.status} /></header>
      <small>{r.provider}{r.cached ? " · cached" : ""}{r.latency_ms ? ` · ${Math.round(r.latency_ms)} ms` : ""}</small>
      {r.status === "LIVE" ? <Prov label="REAL / PUBLIC" /> : <span className="muted">no data shown</span>}
      {r.detail && <p>{r.detail}</p>}
      {r.status === "LIVE" && <details><summary>Inspect response</summary><pre>{JSON.stringify(r.data, null, 2).slice(0, 3000)}</pre></details>}
      {r.limitations && <small className="limits">Limits: {r.limitations}</small>}
    </article>
  );
}

export function LiveContextPanel({ alertKeyword, query, scenario, onApplied, onFetched, token }: {
  alertKeyword: string; query?: string; scenario: Scenario | null; token: string; onApplied?: (s: Scenario) => void;
  onFetched?: (c: LiveContext) => void;
}) {
  const [lat, setLat] = useState(""); const [lon, setLon] = useState("");
  const [ctx, setCtx] = useState<LiveContext | null>(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const valid = lat !== "" && lon !== "" && Math.abs(+lat) <= 90 && Math.abs(+lon) <= 180;

  async function fetchCtx() {
    setBusy(true); setErr("");
    try {
      const q = new URLSearchParams({ lat, lon, alert_keyword: alertKeyword, ...(query ? { q: query } : {}) });
      const c = await request<LiveContext>(`/live-context?${q}`, undefined, token);
      setCtx(c);
      onFetched?.(c);
    } catch (e) { setErr(e instanceof Error ? e.message : "Failed"); } finally { setBusy(false); }
  }
  async function applyRain() {
    if (!scenario) return;
    setBusy(true); setErr("");
    try { onApplied?.(await request<Scenario>(`/scenarios/${scenario.id}/rainfall-input`, { lat: +lat, lon: +lon }, token)); }
    catch (e) { setErr(e instanceof Error ? e.message : "Failed"); } finally { setBusy(false); }
  }
  function locate() {
    navigator.geolocation?.getCurrentPosition(
      p => { setLat(p.coords.latitude.toFixed(4)); setLon(p.coords.longitude.toFixed(4)); },
      () => setErr("Location permission denied; enter coordinates manually."));
  }
  const weather = ctx?.providers.weather;
  const canApply = scenario?.state.mode === "flood" && weather?.status === "LIVE";
  return (
    <section className="panel" aria-labelledby="live-h">
      <h2 id="live-h">Live public evidence <Prov label="REAL / PUBLIC" /></h2>
      <p className="muted">Fetched server-side from public sources. Anything unreachable shows its real status; nothing is substituted.</p>
      <div className="row">
        <label>Latitude<input inputMode="decimal" value={lat} onChange={e => setLat(e.target.value)} /></label>
        <label>Longitude<input inputMode="decimal" value={lon} onChange={e => setLon(e.target.value)} /></label>
        <button className="secondary" onClick={locate} type="button">USE MY LOCATION</button>
        <button disabled={!valid || busy} onClick={fetchCtx}>{busy ? "FETCHING…" : "FETCH LIVE CONTEXT"}</button>
      </div>
      {err && <p className="warning" role="alert">{err}</p>}
      {ctx && <div className="provider-grid">{Object.entries(ctx.providers).map(([k, v]) => <ProviderCard key={k} name={k} r={v} />)}</div>}
      {canApply && <div className="callout">
        <p>Apply the live rainfall to the flood scenario? It becomes a <Prov label="DERIVED" /> input
          (real precipitation × simulated catchment). Any existing run turns stale and approval is cleared.</p>
        <button disabled={busy} onClick={applyRain}>APPLY LIVE RAINFALL TO SCENARIO</button>
      </div>}
    </section>
  );
}

export function AuditVerify({ scenario, token }: { scenario: Scenario; token: string }) {
  const [rep, setRep] = useState<AuditReport | null>(null); const [err, setErr] = useState("");
  async function go() {
    setErr("");
    try { setRep(await request<AuditReport>(`/scenarios/${scenario.id}/audit/verify`, undefined, token)); }
    catch (e) { setErr(e instanceof Error ? e.message : "Verification failed"); }
  }
  return (
    <div className="callout">
      <button onClick={go}>VERIFY AUDIT CHAIN</button>
      {err && <p className="warning" role="alert">{err}</p>}
      {rep && <p role="status" className={rep.valid ? "check-ok" : "check-fail"}>
        {rep.valid ? `CHAIN VALID · ${rep.events} events · head ${rep.head_hash?.slice(0, 12)}…`
          : `CHAIN BROKEN at event ${rep.broken_at_seq}: ${rep.reason}`}
        {rep.sink && <small> · sink {rep.sink}: {rep.sink_consistent ? "consistent" : "NOT consistent"}</small>}
      </p>}
    </div>
  );
}

interface IntegrationRow { integration: string; any_configured: boolean; works_unconfigured: boolean; note: string;
  variables: Array<{ variable: string; set: boolean; secret: boolean; purpose: string }> }

export function IntegrationStatus() {
  const [rows, setRows] = useState<IntegrationRow[] | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    request<{ integrations: IntegrationRow[] }>("/integrations").then(r => setRows(r.integrations))
      .catch(() => setErr("Integration status unavailable: API not reachable."));
  }, []);
  return (
    <section className="panel" aria-labelledby="integ-h">
      <h2 id="integ-h">Integration configuration</h2>
      <p className="muted">Shows whether configuration is <em>present</em> on the backend. Presence is not proof of a working connection;
        values are never shown. The browser map key is checked by the map itself (see the map status chip).</p>
      {err && <p className="warning" role="alert">{err}</p>}
      {!rows && !err && <p className="muted" role="status">Loading…</p>}
      {rows && <div className="table-scroll"><table className="compact">
        <thead><tr><th>Integration</th><th>Configuration</th><th>Variables</th></tr></thead>
        <tbody>{rows.map(r => <tr key={r.integration}>
          <th>{r.integration}</th>
          <td>{r.works_unconfigured ? `Works without configuration (${r.note})` : r.any_configured ? "Some configuration present" : "NOT CONNECTED"}</td>
          <td><small>{r.variables.map(v => `${v.variable}: ${v.set ? "set" : "unset"}`).join(" · ")}</small></td>
        </tr>)}</tbody></table></div>}
    </section>
  );
}
