import { createContext, useContext } from "react";
import type {
  Change, JBoot, JPlan, JPOI, JReq, JRoute, JSegment, NeedResult, RouteId,
} from "./jtypes";

export interface Live {
  route: JRoute; seg: number; t: number; running: boolean; speed: number;
  exposure: number; elapsed: number; arrived: boolean; startedAt: number;
}
export interface Ctx {
  boot: JBoot; req: JReq; setReq: (patch: Partial<JReq>) => void;
  plan: JPlan | null; loading: boolean; error: string; retry: () => void;
  selected: RouteId; select: (id: RouteId) => void;
  route: JRoute | null;
  seg: { route: JRoute; index: number } | null;
  setSeg: (s: { route: JRoute; index: number } | null) => void;
  segment: JSegment | null;
  live: Live | null; startLive: () => void; liveControl: (a: "pause" | "resume" | "end" | "speed") => void;
  need: { open: boolean; loading: boolean; result: NeedResult | null; error: string; node: number } ;
  openNeed: (node?: number) => void; closeNeed: () => void;
  change: Change | null; setChange: (c: Change | null) => void;
  proposeRelief: (poi: JPOI) => Promise<void>;
  proposePatch: (patch: Partial<JReq>, reason: string) => Promise<void>;
  busy: boolean; notice: string; setNotice: (s: string) => void;
}
export const JourneyContext = createContext<Ctx | null>(null);
export function useJ(): Ctx {
  const c = useContext(JourneyContext);
  if (!c) throw new Error("Journey context missing");
  return c;
}
