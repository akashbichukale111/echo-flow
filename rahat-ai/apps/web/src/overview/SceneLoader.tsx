export interface LoadStep { label: string; done: boolean }
export default function SceneLoader({ steps, hiding }: { steps: LoadStep[]; hiding: boolean }) {
  const pct = Math.round((steps.filter(s => s.done).length / steps.length) * 100);
  return <div className={`ov-loader ${hiding ? "out" : ""}`} role="status" aria-live="polite" aria-hidden={hiding}>
    <div className="ov-loader-card">
      <h2>RAHAT<span>AI</span></h2>
      <p>Preparing your thermal environment…</p>
      <div className="ov-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <i style={{ width: `${Math.max(6, pct)}%` }} />
      </div>
      <ul>{steps.map(s => <li key={s.label} className={s.done ? "done" : ""}><span aria-hidden="true" />{s.label}</li>)}</ul>
    </div>
  </div>;
}
