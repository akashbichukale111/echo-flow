import { useEffect, useState } from "react";
import { api } from "./api";
import type { MapData, RouteEstimate } from "./types";

export interface ProviderSummary {
  status?: string; message?: string; source?: string; data_label?: string;
  stations?: number; observations?: number; schemes?: number;
  latest_observed?: string; freshness?: { status: string; age_label: string };
  stale_stations?: number; all_zero_in_file?: boolean; note?: string;
  quality_flags?: string[]; placed_on_map?: number;
  total_capacity_mld?: number; total_utilisation_mld?: number;
  total_domestic_mld?: number; total_industrial_mld?: number;
  near_capacity_schemes?: number; parameters_not_in_file?: string[];
}
export interface DataSummary {
  providers: Record<"groundwater" | "scada" | "discharge" | "water_supply",
    ProviderSummary>;
  statement: string;
  not_connected: Record<string, string>;
  legend: { label: string; meaning: string }[];
}

export interface Loaded<T> {
  data: T | null; error: string; loading: boolean;
}
/** Fetch once per key; a failure is reported, never thrown into the page. */
export function useFetch<T>(path: string | null, key: unknown = path): Loaded<T> {
  const [state, setState] = useState<Loaded<T>>(
    { data: null, error: "", loading: path !== null });
  useEffect(() => {
    if (path === null) { setState({ data: null, error: "", loading: false }); return; }
    const controller = new AbortController();
    setState(s => ({ ...s, loading: true, error: "" }));
    api<T>(path, "GET", undefined, controller.signal)
      .then(data => setState({ data, error: "", loading: false }))
      .catch(e => {
        if (!controller.signal.aborted) setState({
          data: null, loading: false,
          error: e instanceof Error ? e.message : "Request failed" });
      });
    return () => controller.abort();
  }, [path, key]);
  return state;
}
export const useMapData = () => useFetch<MapData>("/data/map");
export const useDataSummary = () => useFetch<DataSummary>("/data/summary");
export const useRoute = (zoneId: string | null) =>
  useFetch<RouteEstimate>(zoneId ? `/zones/${zoneId}/route` : null);
