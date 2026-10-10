import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import type { ReactNode } from "react";
import * as THREE from "three";
import { LEN, SWAY } from "./config";
import type { Motion } from "./config";

export interface Item { p: [number, number, number]; s?: number; sy?: number; ry?: number; tint?: string }

export function Scatter({ geometry, material, items, cast = true, receive = false }: {
  geometry: THREE.BufferGeometry; material: THREE.Material; items: Item[]; cast?: boolean; receive?: boolean;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const o = new THREE.Object3D();
    const c = new THREE.Color();
    items.forEach((it, i) => {
      o.position.set(...it.p);
      o.rotation.set(0, it.ry ?? 0, 0);
      const s = it.s ?? 1;
      o.scale.set(s, s * (it.sy ?? 1), s);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
      if (it.tint) { c.set(it.tint); m.setColorAt(i, c); }
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [items]);
  return <instancedMesh ref={ref} args={[geometry, material, items.length]} castShadow={cast}
    receiveShadow={receive} frustumCulled={false} />;
}

/** Foliage material: vertex colours + wind sway driven by a shared time uniform. */
export function useFoliageMaterial(roughness = 0.85) {
  return useMemo(() => {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness, metalness: 0 });
    m.onBeforeCompile = shader => {
      shader.uniforms.uTime = SWAY.uTime;
      shader.uniforms.uAmp = SWAY.uAmp;
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nuniform float uTime;\nuniform float uAmp;")
        .replace("#include <begin_vertex>", `#include <begin_vertex>
          float sw = sin(uTime * 1.25 + instanceMatrix[3].x * 0.35 + instanceMatrix[3].z * 0.21 + position.x * 1.7)
            * uAmp * smoothstep(0.4, 5.0, position.y);
          transformed.x += sw; transformed.z += sw * 0.6;`);
    };
    m.customProgramCacheKey = () => "foliage-sway";
    return m;
  }, [roughness]);
}

/** Repeats its children every LEN metres and slides them toward the camera. */
export function Scroller({ motion, children }: { motion: Motion; children: ReactNode }) {
  const a = useRef<THREE.Group>(null);
  const b = useRef<THREE.Group>(null);
  useFrame(() => {
    const o = motion.dist % LEN;
    if (a.current) a.current.position.z = o;
    if (b.current) b.current.position.z = o - LEN;
  });
  return <>
    <group ref={a}>{children}</group>
    <group ref={b}>{children}</group>
  </>;
}
