import type { Vec2 } from '@/state/deskBoundsStore';

/**
 * Check if a point is inside a polygon using ray casting algorithm
 *
 * Algorithm: Cast a ray from the point to infinity (horizontal ray to the right)
 * and count how many times it intersects the polygon edges.
 * If odd number of intersections, point is inside. If even, point is outside.
 *
 * @param point - The point to test (x, z in world space)
 * @param polygon - Array of vertices defining the polygon (ordered)
 * @returns true if point is inside polygon, false otherwise
 */
export function pointInPolygon(point: Vec2, polygon: Vec2[]): boolean {
  if (polygon.length < 3) return false;

  let inside = false;
  const [px, pz] = point;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, zi] = polygon[i];
    const [xj, zj] = polygon[j];

    // Check if horizontal ray from point intersects this edge
    const intersect = ((zi > pz) !== (zj > pz)) &&
                      (px < (xj - xi) * (pz - zi) / (zj - zi) + xi);

    if (intersect) inside = !inside;
  }

  return inside;
}

/**
 * Calculate the centroid (geometric center) of a polygon
 *
 * @param polygon - Array of vertices defining the polygon
 * @returns The centroid point [x, z]
 */
export function polygonCentroid(polygon: Vec2[]): Vec2 {
  if (polygon.length === 0) return [0, 0];

  let sumX = 0;
  let sumZ = 0;

  for (const [x, z] of polygon) {
    sumX += x;
    sumZ += z;
  }

  return [sumX / polygon.length, sumZ / polygon.length];
}
