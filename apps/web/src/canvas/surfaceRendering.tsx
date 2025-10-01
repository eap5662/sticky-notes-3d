"use client";

import * as THREE from "three";

/**
 * Provides baseline lighting + an optional world reference grid.
 * Geometry now comes from GLTF props, so we keep this focused on ambience only.
 */
export function Surfaces() {
  return (
    <>
      <hemisphereLight intensity={0.6} color={"#bcd"} groundColor={"#262626"} />
      <directionalLight position={[2, 3, 2]} intensity={0.9} />
      <directionalLight position={[-2, 1.5, -1]} intensity={0.4} />
      <FaintGrid />
    </>
  );
}

function FaintGrid() {
  const grid = new THREE.GridHelper(40, 40, 0x4a4a4a, 0x2e2e2e);
  grid.material.depthWrite = false;
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.25;
  return <primitive object={grid} />;
}
