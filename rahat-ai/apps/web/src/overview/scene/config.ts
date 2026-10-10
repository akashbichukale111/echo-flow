import * as THREE from "three";

export const LEN = 160;
export const ROAD_W = 8.4;
export const IDLE_SPEED = 4.2;
export const SUN_DIR = new THREE.Vector3(-0.38, 0.4, -0.84).normalize();

export interface Quality { low: boolean; shadow: number; dpr: [number, number]; density: number }
export function detectQuality(): Quality {
  const narrow = typeof window !== "undefined" && window.innerWidth < 760;
  const weak = typeof navigator !== "undefined" && (navigator.hardwareConcurrency || 8) <= 4;
  const low = narrow || weak;
  return {
    low, shadow: low ? 1024 : 2048, dpr: narrow ? [1, 1.25] : [1, 1.6], density: low ? 0.55 : 1,
  };
}

/** Shared mutable motion state, written once per frame by the scene root. */
export interface Motion { dist: number; speed: number; time: number }
export interface Highlight { kind: string | null; thermal: boolean; all: boolean }

export const SWAY = { uTime: { value: 0 }, uAmp: { value: 0.07 } };
