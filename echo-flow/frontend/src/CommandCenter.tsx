import { Suspense, lazy, useState, type ReactNode } from "react";
import type { MapConfig } from "./mapConfig";
import { CompareStrip, OpsPanel, type OpsProps } from "./Ops";
import type { LayerState } from "./MapView";
import type { Anchor } from "./geo";
import type { LiveContext, MapPhase, PickMode, RouteState, Scenario } from "./types";

const MapView = lazy(() => import("./MapView"));

interface Props extends Omit<OpsProps, "mapPhase"> {
  config: MapConfig;
  scenario: Scenario;
  anchor: Anchor | null;
  onAnchor: (a: Anchor) => void;
  onSelect: (id: string | null) => void;
  liveCtx: LiveContext | null;
  route: RouteState;
  pickMode: PickMode;
  onPick: (mode: PickMode, lngLat: [number, number]) => void;
  onCancelPick: () => void;
  mapPhase: MapPhase;
  onMapPhase: (p: MapPhase, reason: string) => void;
  clock: ReactNode;
}

export default function CommandCenter(p: Props) {
  const [layers, setLayers] = useState<LayerState>({ entities: true, links: true, route: true, live: true });
  const { clock, config, onAnchor, onSelect, onPick, onCancelPick, onMapPhase, ...ops } = p;
  return (
    <div className="cc">
      <section className="cc-map" aria-label="Operations map">
        <Suspense fallback={<div className="map-loading" role="status"><span className="skeleton-bar" />Loading map…</div>}>
          <MapView config={config} scenario={p.scenario} anchor={p.anchor} onAnchor={onAnchor}
            selectedId={p.selectedId} onSelect={onSelect} layers={layers} onLayers={setLayers}
            liveCtx={p.liveCtx} route={p.route} pickMode={p.pickMode} onPick={onPick}
            onRequestPick={p.onRequestPick} onCancelPick={onCancelPick} onPhase={onMapPhase} />
        </Suspense>
      </section>
      <aside className="cc-ops" aria-label="Operational panel"><OpsPanel {...ops} onSelectOption={onSelect} /></aside>
      <section className="cc-compare" aria-label="Decision comparison"><CompareStrip scenario={p.scenario} clock={clock} /></section>
    </div>
  );
}
