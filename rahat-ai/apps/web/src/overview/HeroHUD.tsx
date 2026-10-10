import { RELIEF_ICON, SunIcon } from "./icons";
import { RELIEF_KINDS, RELIEF_LABEL, classWord, distLabel } from "./overviewData";
import type { NearestMap, ReliefKind } from "./overviewData";
import type { HeatClass } from "../journey/jtypes";

export interface HudProps {
  tempC: number | null; exposure: HeatClass | null; nearest: NearestMap; active: ReliefKind | null;
  thermalOn: boolean;
  onThermal: (on: boolean) => void; onHover: (k: ReliefKind | null) => void; onSelect: (k: ReliefKind) => void;
}

export default function HeroHUD(p: HudProps) {
  return <section className="ov-hud" aria-label="Journey intelligence. Demo data, model estimates.">
    <div className="ov-hud-cell static" data-tone="thermal">
      <span className="ov-hud-ico"><SunIcon size={18} /></span>
      <small>CURRENT HEAT</small>
      <b>{p.tempC != null ? `${Math.round(p.tempC)}°C` : "—"}</b>
      <em>Scenario temperature</em>
    </div>
    <button type="button" className={`ov-hud-cell ${p.thermalOn ? "on" : ""}`} data-tone={p.exposure === "LOW" ? "relief" : "thermal"}
      onPointerEnter={() => p.onThermal(true)} onPointerLeave={() => p.onThermal(false)}
      onFocus={() => p.onThermal(true)} onBlur={() => p.onThermal(false)}
      aria-label={`Estimated thermal exposure ${p.exposure ? classWord(p.exposure) : "unavailable"}. Highlights the affected road`}>
      <span className="ov-hud-ico"><i className="ov-heat-dot" /></span>
      <small>THERMAL EXPOSURE</small>
      <b>{p.exposure ? classWord(p.exposure) : "—"}</b>
      <em>Route thermal load · estimate</em>
    </button>
    {RELIEF_KINDS.map(k => {
      const Icon = RELIEF_ICON[k];
      const n = p.nearest[k];
      return <button type="button" key={k} data-tone="relief" className={`ov-hud-cell ${p.active === k ? "on" : ""}`}
        onPointerEnter={() => p.onHover(k)} onPointerLeave={() => p.onHover(null)}
        onFocus={() => p.onHover(k)} onBlur={() => p.onHover(null)} onClick={() => p.onSelect(k)}
        aria-label={`${RELIEF_LABEL[k]}: ${n ? distLabel(n.meters) : "none in demo data"}. Show on scene`}>
        <span className="ov-hud-ico"><Icon size={18} /></span>
        <small>{RELIEF_LABEL[k].toUpperCase()}</small>
        <b>{n ? distLabel(n.meters) : "—"}</b>
        <em>Straight-line · demo data</em>
      </button>;
    })}
  </section>;
}
