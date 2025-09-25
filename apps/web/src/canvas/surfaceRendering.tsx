"use client";

import * as THREE from "three";
import { useMemo } from "react";
import { getAllSurfaces, type Surface } from "@/canvas/surfaces";
import { uvToWorld } from "@/canvas/math/plane";

/**
 * Builds a BufferGeometry for a single surface by sampling the 4 corners.
 * We convert (u,v) ∈ {(0,0),(1,0),(1,1),(0,1)} into world points and make two triangles.
 */
function geometryFromSurface(surface: Surface) {
  const p00 = new THREE.Vector3();
  const p10 = new THREE.Vector3();
  const p11 = new THREE.Vector3();
  const p01 = new THREE.Vector3();

  uvToWorld(0, 0, surface, p00);
  uvToWorld(1, 0, surface, p10);
  uvToWorld(1, 1, surface, p11);
  uvToWorld(0, 1, surface, p01);

  const geom = new THREE.BufferGeometry();
  const verts = new Float32Array([
    // tri 1
    p00.x, p00.y, p00.z,
    p10.x, p10.y, p10.z,
    p11.x, p11.y, p11.z,
    // tri 2
    p00.x, p00.y, p00.z,
    p11.x, p11.y, p11.z,
    p01.x, p01.y, p01.z,
  ]);
  geom.setAttribute("position", new THREE.BufferAttribute(verts, 3));
  geom.computeVertexNormals();
  return geom;
}

/**
 * Renders all planes from the surfaces registry.
 * - Desk: light, rough material
 * - Monitor: dark, matte material
 * Also adds gentle ambient + directional lights so the planes are visible.
 */
export function Surfaces() {
  const surfaces = getAllSurfaces();

  // Build static geometries once per render of the registry (cheap and deterministic).
  const geoms = useMemo(
    () => surfaces.map((s) => ({ surface: s, geom: geometryFromSurface(s) })),
    [surfaces]
  );

  return (
    <>
      {geoms.map(({ surface, geom }) => (
        <mesh key={surface.id} geometry={geom}>
          <meshStandardMaterial
            color={surface.kind === "desk" ? "#cfcfcf" : "#222"}
            roughness={surface.kind === "desk" ? 0.9 : 1.0}
            metalness={0.0}
          />
        </mesh>
      ))}

      {/* Soft lighting so we see the planes without blowing out contrast */}
      <ambientLight intensity={0.4} />
      <directionalLight position={[2, 3, 2]} intensity={0.8} />
    </>
  );
}
