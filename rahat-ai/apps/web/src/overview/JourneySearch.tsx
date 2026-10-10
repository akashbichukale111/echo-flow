import { useEffect, useId, useRef, useState } from "react";
import { api } from "../api";
import type { Place } from "../journey/jtypes";
import { ArrowIcon, LocateIcon, SearchIcon } from "./icons";

const clean = (n: string) => n.replace(/ \(demo node\)$/, "");

export interface PickedPlace { name: string; node: number }

export default function JourneySearch({ originName, destinationName, onPick, onOutside, onFocusChange }: {
  originName: string; destinationName: string;
  onPick: (p: PickedPlace) => void; onOutside: (name: string) => void; onFocusChange: (f: boolean) => void;
}) {
  const id = useId();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Place[] | null>(null);
  const [err, setErr] = useState("");
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const c = new AbortController();
    const t = setTimeout(() => {
      api<{ items: Place[] }>(`/journey/search?q=${encodeURIComponent(q)}`, undefined, c.signal)
        .then(r => { setItems(r.items); setErr(""); setActive(0); })
        .catch(e => { if (e.name !== "AbortError") setErr("Search is unavailable right now."); });
    }, 160);
    return () => { clearTimeout(t); c.abort(); };
  }, [q, open]);

  useEffect(() => {
    const away = (e: PointerEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, []);

  const choose = (p: Place) => {
    if (p.node == null) { onOutside(p.name); return; }
    onPick({ name: p.name, node: p.node });
    setQ(""); setOpen(false);
  };
  const onKey = (e: React.KeyboardEvent) => {
    const n = items?.length ?? 0;
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive(a => (n ? (a + 1) % n : 0)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive(a => (n ? (a - 1 + n) % n : 0)); }
    else if (e.key === "Escape") setOpen(false);
    else if (e.key === "Enter" && open && items?.[active]) { e.preventDefault(); choose(items[active]); }
  };

  return <div className="ov-search" ref={box}>
    <div className="ov-search-origin" title="Journeys start from the demo start point. No GPS is read.">
      <LocateIcon size={18} />
      <span className="ov-search-text"><small>CURRENT LOCATION · SIMULATED</small><b>{clean(originName)}</b></span>
    </div>
    <span className="ov-search-arrow" aria-hidden="true"><ArrowIcon size={16} /></span>
    <div className="ov-search-dest">
      <SearchIcon size={18} />
      <label className="ov-search-text" htmlFor={`${id}-in`}>
        <small>DESTINATION</small>
        <input id={`${id}-in`} role="combobox" aria-expanded={open} aria-controls={`${id}-list`} aria-autocomplete="list"
          aria-activedescendant={open && items?.[active] ? `${id}-o${active}` : undefined}
          value={q} placeholder={clean(destinationName) || "Where do you want to go?"} autoComplete="off" spellCheck={false}
          onChange={e => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => { setOpen(true); onFocusChange(true); }} onBlur={() => onFocusChange(false)} onKeyDown={onKey} />
      </label>
    </div>
    {open && <ul id={`${id}-list`} className="ov-results" role="listbox" aria-label="Destination suggestions">
      {err && <li className="ov-res-note" role="option" aria-selected="false" aria-disabled="true">{err}</li>}
      {!err && items && items.length === 0 && <li className="ov-res-note" role="option" aria-selected="false" aria-disabled="true">
        No demo place matches “{q}”.</li>}
      {!err && !items && <li className="ov-res-note" role="option" aria-selected="false" aria-disabled="true">Searching…</li>}
      {items?.map((p, i) => <li key={p.name} id={`${id}-o${i}`} role="option" aria-selected={i === active}
        aria-disabled={p.node == null} className={`${i === active ? "on" : ""} ${p.node == null ? "off" : ""}`}
        onPointerDown={e => e.preventDefault()} onClick={() => choose(p)} onPointerEnter={() => setActive(i)}>
        <b>{p.name}</b>
        <small>{p.node != null ? "Inside demo coverage · DEMO DATA" : "Outside the schematic demo area"}</small>
      </li>)}
    </ul>}
  </div>;
}
