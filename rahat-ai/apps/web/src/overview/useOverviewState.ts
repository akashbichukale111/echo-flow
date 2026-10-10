import { useEffect, useState } from "react";

export function useReducedMotion(): boolean {
  const [r, setR] = useState(() => !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return;
    const h = () => setR(mq.matches);
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, []);
  return r;
}

export function hasWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch { return false; }
}

/** True while the element is on screen and the tab is visible, so rendering can pause. */
export function useVisible(ref: React.RefObject<Element>): boolean {
  const [vis, setVis] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let inView = true;
    const apply = () => setVis(inView && !document.hidden);
    const io = new IntersectionObserver(([e]) => { inView = e.isIntersecting; apply(); }, { threshold: 0.02 });
    io.observe(el);
    document.addEventListener("visibilitychange", apply);
    return () => { io.disconnect(); document.removeEventListener("visibilitychange", apply); };
  }, [ref]);
  return vis;
}

/** Staged cinematic entrance: returns the highest stage reached (0..6). */
export function useStages(go: boolean, reduced: boolean): number {
  const [stage, setStage] = useState(0);
  useEffect(() => {
    if (!go) return;
    if (reduced) { setStage(6); return; }
    const times = [0, 650, 1500, 1950, 2350, 2750];
    const ids = times.map((t, i) => window.setTimeout(() => setStage(i + 1), t));
    return () => ids.forEach(clearTimeout);
  }, [go, reduced]);
  return stage;
}
