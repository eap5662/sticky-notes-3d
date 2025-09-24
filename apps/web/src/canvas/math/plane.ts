import * as THREE from "three";
import type { Surface } from "@/canvas/surfaces";

// u,v in [0..1] → world
export function uvToWorld(u: number, v: number, surface: Surface, out = new THREE.Vector3()) {
  const o = surface.origin, U = surface.uAxis, V = surface.vAxis;
  out.set(
    o[0] + u * U[0] + v * V[0],
    o[1] + u * U[1] + v * V[1],
    o[2] + u * U[2] + v * V[2],
  );
  return out; //returns a 3d point in world space
}

/**
 * Projects a ray onto a surface's plane and returns intersection data.
 *
 * - Given a THREE.Ray (e.g. from a mouse click into the scene) and a Surface definition
 *   (origin + uAxis + vAxis),
 * - Finds the intersection point P in world space,
 * - Solves for (u,v) coordinates relative to the surface axes,
 * - Returns both the world hit point and the local coordinates.
 *
 * Typical usage:
 *   const ray = new THREE.Ray(cameraPos, rayDir);
 *   const hit = planeProject(ray, surface);
 *   if (hit.hit && hit.u >= 0 && hit.u <= 1 && hit.v >= 0 && hit.v <= 1) {
 *     // Inside the surface bounds
 *   }
 */
export function planeProject(ray: THREE.Ray, surface: Surface) {
  // Surface basis: origin O, spanning vectors U and V
  const U = new THREE.Vector3(...surface.uAxis);
  const V = new THREE.Vector3(...surface.vAxis);
  const O = new THREE.Vector3(...surface.origin);

  // Plane normal = U × V
  const N = new THREE.Vector3().crossVectors(U, V).normalize();

  // Ray-plane intersection test
  const denom = N.dot(ray.direction);
  if (Math.abs(denom) < 1e-6) {
    // Ray is parallel to plane → no hit
    return { hit: false } as const;
  }

  // Solve for intersection parameter t
  const t = N.dot(new THREE.Vector3().subVectors(O, ray.origin)) / denom;
  if (t < 0) {
    // Intersection is behind the ray origin → ignore
    return { hit: false } as const;
  }

  // Compute world-space intersection point
  const P = new THREE.Vector3()
    .copy(ray.direction)
    .multiplyScalar(t)
    .add(ray.origin);

  // Express P relative to surface origin: PO = P - O
  const PO = new THREE.Vector3().subVectors(P, O);

  // Build dot products for Gram matrix
  const ux = U.dot(U);
  const vx = V.dot(V);
  const uv = U.dot(V);
  const det = ux * vx - uv * uv;

  if (Math.abs(det) < 1e-8) {
    // U and V are not independent → degenerate plane
    return { hit: false } as const;
  }

  // Right-hand side of system
  const Pu = PO.dot(U);
  const Pv = PO.dot(V);

  // Solve 2x2 system for (u,v) using Cramer's rule
  const u = (vx * Pu - uv * Pv) / det;
  const v = (-uv * Pu + ux * Pv) / det;

  return { hit: true, u, v, point: P } as const;
}
