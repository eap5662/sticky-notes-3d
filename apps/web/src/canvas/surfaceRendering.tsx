"use client";

import * as THREE from "three";
import { useMemo } from "react";
import { getAllSurfaces, type Surface } from "@/canvas/surfaces";
import { uvToWorld } from "@/canvas/math/plane";

function basisFromSurface(surface: Surface) { //helper
  // U = "right" vector of the plane
  const U = new THREE.Vector3().fromArray(surface.uAxis as any);
  // V = "up" (or depth) vector of the plane
  const V = new THREE.Vector3().fromArray(surface.vAxis as any);
  // N = plane normal, computed from U × V
  const N = new THREE.Vector3().copy(U).cross(V).normalize();
  // O = origin (anchor point of the surface in world coords)
  const O = new THREE.Vector3().fromArray(surface.origin as any);

  // Step 1: make a rotation/scale basis
  const M = new THREE.Matrix4().makeBasis(U, V, N);

  // Step 2: add translation for the origin
  const T = new THREE.Matrix4().makeTranslation(O.x, O.y, O.z);

  // Step 3: combine: apply basis, then move to origin
  return new THREE.Matrix4().multiplyMatrices(T, M);
}

function length(v: THREE.Vector3) { return v.length(); } //helper

function vec3(a: readonly number[]) { //helper
  return new THREE.Vector3(a[0], a[1], a[2]);
}


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
  const all = getAllSurfaces();
  const desk = all.find((s) => s.id === "desk");
  const monitor = all.find((s) => s.id === "monitor1");

  return (
    <>
      {/* Lights */}
      <hemisphereLight intensity={0.6} color={"#bcd"} groundColor={"#262626"} />
      <directionalLight position={[2, 3, 2]} intensity={0.9} />
      <directionalLight position={[-2, 1.5, -1]} intensity={0.4} />

      {/* World grid (very faint) */}
      <FaintGrid />

      {/* Desk slab (solid piece with thickness below the plane) */}
      {desk && <DeskSlab surface={desk} thickness={0.04} />}

      {/* Monitor bezel + slightly emissive screen face */}
      {monitor && <MonitorBezelAndScreen surface={monitor} />}
    </>
  );
}

// --- Desk slab, monitor bezel, monitor screen, and faintgrid ---

function DeskSlab({ surface, thickness = 0.04 }: { surface: Surface; thickness?: number }) {
  // Size from axes
  const U = new THREE.Vector3().fromArray(surface.uAxis as any);
  const V = new THREE.Vector3().fromArray(surface.vAxis as any);
  const w = length(U);
  const d = length(V);

  // Place slab so its top is flush with the plane, thickness extends "below"
  const N = new THREE.Vector3().copy(U).cross(V).normalize();
  const center = //returns center of new desk slab
    new THREE.Vector3().fromArray(surface.origin as any)
      .addScaledVector(U, 0.5)
      .addScaledVector(V, 0.5)
      .addScaledVector(N, -thickness * 0.5); //multiplying by negative extends downward

  return (
    <mesh position={center.toArray()}>
      <boxGeometry args={[w, thickness, d]} />
      <meshStandardMaterial metalness={0.0} roughness={0.9} color={"#7a7d82"} />
    </mesh>
  );
}

function MonitorBezelAndScreen({ surface }: { surface: Surface }) {
  const U = new THREE.Vector3().fromArray(surface.uAxis as any);
  const V = new THREE.Vector3().fromArray(surface.vAxis as any);
  const N = U.clone().cross(V).normalize();

  const M = basisFromSurface(surface); // includes O + scaled U,V + N

  const b = 0.02; // 2% bezel relative to [0..1] uv-space

  return (
    <group matrix={M} matrixAutoUpdate={false}>
      {/* Bezel/backing: full plane in uv-space */}
      <mesh position={[0.5, 0.5, 0]}>
        <planeGeometry args={[1, 1]} />
        <meshStandardMaterial color={"#1a1f2a"} roughness={0.6} metalness={0.05} />
      </mesh>

      {/* Inner screen face: slightly smaller, lifted a hair along local +z (== world N) */}
      <mesh position={[0.5, 0.5, 0.001]}>
        <planeGeometry args={[1 - 2 * b, 1 - 2 * b]} />
        <meshStandardMaterial
          color={"#2b6cb0"}
          emissive={"#274b7a"}
          emissiveIntensity={0.25}
          roughness={0.7}
          metalness={0.0}
          // If your U×V happens to point away from camera at some angles, un-comment:
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}


function FaintGrid() {
  const g = new THREE.GridHelper(40, 40, 0x4a4a4a, 0x2e2e2e);
  g.material.depthWrite = false;
  (g.material as any).transparent = true;
  (g.material as any).opacity = 0.25;
  return <primitive object={g} />;
}
