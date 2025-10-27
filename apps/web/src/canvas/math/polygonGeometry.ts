import * as THREE from 'three';

/**
 * Polygon geometry utilities for extracting surface boundaries from 3D meshes.
 *
 * Implements Tier B extraction: Boundary edge detection from coplanar triangles.
 * - Selects triangles parallel to plane and within height tolerance
 * - Extracts boundary edges (used by exactly one triangle)
 * - Orders edges into closed rings
 * - Projects to UV space and simplifies with RDP + axis snapping
 */

type UV = [number, number];

export type PolygonRings = {
  outer: UV[];
  holes: UV[][];
};

export type ExtractionParams = {
  normalDotMin: number;    // Parallelism threshold (0.98-0.995)
  heightEps: number;       // Height band tolerance in meters (0.0005-0.005)
  simplifyEps: number;     // RDP simplification epsilon in meters (0.001-0.003)
  snapDeg: number;         // Axis-snap angle tolerance in degrees (5-8)
  vertexMergeEps: number;  // Vertex deduplication tolerance in meters (0.0005-0.001)
  spatialHashTol: number;  // Edge matching tolerance for spatial hashing (0.0001)
};

export const DEFAULT_EXTRACTION_PARAMS: ExtractionParams = {
  normalDotMin: 0.985,
  heightEps: 0.002,        // 2mm
  simplifyEps: 0.005,      // 5mm - less aggressive for now
  snapDeg: 6,
  vertexMergeEps: 0.002,   // 2mm - less aggressive merging
  spatialHashTol: 0.0001,  // 0.1mm
};

type Triangle = {
  a: THREE.Vector3;
  b: THREE.Vector3;
  c: THREE.Vector3;
  normal: THREE.Vector3;
};

type Edge = {
  a: THREE.Vector3;
  b: THREE.Vector3;
};

/**
 * Extract polygon boundary from a 3D mesh node.
 * Returns null if extraction fails (fallback to rect).
 */
export function extractPolygonFromNode(
  node: THREE.Object3D,
  planeOrigin: THREE.Vector3,
  planeNormal: THREE.Vector3,
  uDir: THREE.Vector3,
  vDir: THREE.Vector3,
  params: ExtractionParams = DEFAULT_EXTRACTION_PARAMS
): PolygonRings | null {
  // Step 1: Collect coplanar triangles
  const triangles = collectCoplanarTriangles(node, planeOrigin, planeNormal, params);
  if (triangles.length === 0) {
    console.warn('[polygonGeometry] ❌ FAILED: No coplanar triangles found');
    return null;
  }

  console.log(`[polygonGeometry] ✓ Found ${triangles.length} coplanar triangles`);

  // Step 2: Extract boundary edges
  const boundaryEdges = extractBoundaryEdges(triangles, params.spatialHashTol);

  // Fallback: If no boundary edges (closed mesh), try to extract silhouette from triangle edges
  if (boundaryEdges.length === 0) {
    console.warn('[polygonGeometry] ⚠️ No boundary edges found (closed mesh). Attempting silhouette extraction...');
    return extractSilhouetteFromTriangles(triangles, planeOrigin, uDir, vDir, params);
  }

  console.log(`[polygonGeometry] ✓ Found ${boundaryEdges.length} boundary edges`);

  // Step 3: Order edges into rings
  const rings3D = orderEdgesIntoRings(boundaryEdges, params.spatialHashTol);
  if (rings3D.length === 0) {
    console.warn('[polygonGeometry] ❌ FAILED: Failed to order edges into rings');
    return null;
  }

  console.log(`[polygonGeometry] ✓ Ordered into ${rings3D.length} ring(s)`);

  // Step 4: Project to UV and simplify
  const ringsUV = projectRingsToUV(rings3D, planeOrigin, uDir, vDir);
  console.log('[polygonGeometry] ✓ Projected rings to UV:', ringsUV.map(r => `${r.length} points`));

  const simplifiedRings = simplifyRings(ringsUV, params);
  console.log('[polygonGeometry] ✓ Simplified rings:', simplifiedRings.map(r => `${r.length} points`));

  // Step 5: Choose outer and holes
  const result = chooseOuterAndHoles(simplifiedRings);
  console.log('[polygonGeometry] ✓ Final result:', {
    outer: result.outer.length,
    holes: result.holes.length,
  });

  if (result.outer.length === 0) {
    console.warn('[polygonGeometry] ❌ FAILED: Result has 0 outer points');
    return null;
  }

  return result;
}

/**
 * Collect triangles that are parallel to plane and within height tolerance.
 */
function collectCoplanarTriangles(
  node: THREE.Object3D,
  planeOrigin: THREE.Vector3,
  planeNormal: THREE.Vector3,
  params: ExtractionParams
): Triangle[] {
  const triangles: Triangle[] = [];
  const vertex = new THREE.Vector3();
  const normalVec = new THREE.Vector3();

  node.traverse((obj) => {
    const mesh = obj as THREE.Mesh<THREE.BufferGeometry>;
    if (!mesh.isMesh || !mesh.geometry) return;

    const position = mesh.geometry.attributes.position;
    const normal = mesh.geometry.attributes.normal;
    if (!position) return;

    const index = mesh.geometry.index;
    const triCount = index ? index.count / 3 : position.count / 3;

    for (let i = 0; i < triCount; i++) {
      const i0 = index ? index.getX(i * 3) : i * 3;
      const i1 = index ? index.getX(i * 3 + 1) : i * 3 + 1;
      const i2 = index ? index.getX(i * 3 + 2) : i * 3 + 2;

      const a = new THREE.Vector3().fromBufferAttribute(position, i0).applyMatrix4(mesh.matrixWorld);
      const b = new THREE.Vector3().fromBufferAttribute(position, i1).applyMatrix4(mesh.matrixWorld);
      const c = new THREE.Vector3().fromBufferAttribute(position, i2).applyMatrix4(mesh.matrixWorld);

      // Compute triangle normal
      const ab = new THREE.Vector3().subVectors(b, a);
      const ac = new THREE.Vector3().subVectors(c, a);
      const triNormal = new THREE.Vector3().crossVectors(ab, ac).normalize();

      // Check parallelism AND direction (only accept triangles pointing same way as planeNormal)
      // IMPORTANT: We want triangles facing the SAME direction (not opposite),
      // otherwise we get both top and bottom faces of closed meshes (causing no boundary edges).
      // We use dot product WITHOUT Math.abs() to enforce directionality, but we use a
      // slightly relaxed threshold to account for slight normal variations in tessellated surfaces.
      const dot = triNormal.dot(planeNormal);
      if (dot < Math.max(params.normalDotMin, 0.9)) continue; // Must point same direction (at least 25° tolerance)

      // Check height to plane (max distance among vertices)
      const ha = Math.abs(new THREE.Vector3().subVectors(a, planeOrigin).dot(planeNormal));
      const hb = Math.abs(new THREE.Vector3().subVectors(b, planeOrigin).dot(planeNormal));
      const hc = Math.abs(new THREE.Vector3().subVectors(c, planeOrigin).dot(planeNormal));
      const hMax = Math.max(ha, hb, hc);

      if (hMax > params.heightEps) continue;

      triangles.push({ a, b, c, normal: triNormal });
    }
  });

  return triangles;
}

/**
 * Extract boundary edges (used by exactly one triangle).
 * Uses spatial hashing for robust edge matching with tolerance.
 */
function extractBoundaryEdges(triangles: Triangle[], tolerance: number): Edge[] {
  const edgeMap = new Map<string, Edge[]>();

  // Collect all edges with spatial hashing
  for (const tri of triangles) {
    const edges: Edge[] = [
      { a: tri.a, b: tri.b },
      { a: tri.b, b: tri.c },
      { a: tri.c, b: tri.a },
    ];

    for (const edge of edges) {
      const key = makeEdgeKey(edge.a, edge.b, tolerance);
      if (!edgeMap.has(key)) edgeMap.set(key, []);
      edgeMap.get(key)!.push(edge);
    }
  }

  // Debug: log edge usage histogram
  const usageCounts = new Map<number, number>();
  for (const edges of edgeMap.values()) {
    const count = edges.length;
    usageCounts.set(count, (usageCounts.get(count) || 0) + 1);
  }
  console.log('[extractBoundaryEdges] Edge usage histogram:', Array.from(usageCounts.entries()).sort((a, b) => a[0] - b[0]));

  // Extract edges used by exactly one triangle
  const boundary: Edge[] = [];
  for (const edges of edgeMap.values()) {
    if (edges.length === 1) {
      boundary.push(edges[0]);
    }
  }

  if (boundary.length === 0 && edgeMap.size > 0) {
    console.warn('[extractBoundaryEdges] No boundary edges found - all edges used by 2+ triangles (closed mesh?)');
    console.log('[extractBoundaryEdges] Total unique edges:', edgeMap.size);
    console.log('[extractBoundaryEdges] Triangles collected:', triangles.length);
  }

  return boundary;
}

/**
 * Create undirected edge key with spatial hashing for tolerance-based matching.
 */
function makeEdgeKey(a: THREE.Vector3, b: THREE.Vector3, tolerance: number): string {
  const snap = (v: number) => Math.round(v / tolerance) * tolerance;

  const p1 = [snap(a.x), snap(a.y), snap(a.z)];
  const p2 = [snap(b.x), snap(b.y), snap(b.z)];

  // Sort to make undirected
  const [min, max] = p1 < p2 ? [p1, p2] : [p2, p1];

  return `${min.join(',')}-${max.join(',')}`;
}

/**
 * Order boundary edges into closed rings.
 */
function orderEdgesIntoRings(edges: Edge[], tolerance: number): THREE.Vector3[][] {
  if (edges.length === 0) return [];

  console.log(`[orderEdgesIntoRings] Processing ${edges.length} edges with tolerance ${tolerance}`);

  // Build adjacency graph
  const graph = new Map<string, THREE.Vector3[]>();

  for (const edge of edges) {
    const keyA = makeVertexKey(edge.a, tolerance);
    const keyB = makeVertexKey(edge.b, tolerance);

    if (!graph.has(keyA)) graph.set(keyA, []);
    if (!graph.has(keyB)) graph.set(keyB, []);

    graph.get(keyA)!.push(edge.b);
    graph.get(keyB)!.push(edge.a);
  }

  console.log(`[orderEdgesIntoRings] Graph has ${graph.size} unique vertices`);

  // Check vertex degrees
  const degreeHistogram = new Map<number, number>();
  for (const neighbors of graph.values()) {
    const degree = neighbors.length;
    degreeHistogram.set(degree, (degreeHistogram.get(degree) || 0) + 1);
  }
  console.log('[orderEdgesIntoRings] Vertex degree histogram:', JSON.stringify(Array.from(degreeHistogram.entries()), null, 2));

  const visitedEdges = new Set<string>();
  const rings: THREE.Vector3[][] = [];
  let ringIndex = 0;

  for (const startKey of graph.keys()) {
    // Check if any edges from this vertex are unvisited
    const neighbors = graph.get(startKey);
    if (!neighbors) continue;

    let hasUnvisitedEdge = false;
    for (const neighbor of neighbors) {
      const nKey = makeVertexKey(neighbor, tolerance);
      const edgeKey = makeEdgeKeyDirected(startKey, nKey);
      if (!visitedEdges.has(edgeKey)) {
        hasUnvisitedEdge = true;
        break;
      }
    }

    if (!hasUnvisitedEdge) continue;

    // Find the actual start position
    const startPos = edges.find(e =>
      makeVertexKey(e.a, tolerance) === startKey ||
      makeVertexKey(e.b, tolerance) === startKey
    );
    if (!startPos) continue;

    const start = makeVertexKey(startPos.a, tolerance) === startKey ? startPos.a : startPos.b;
    const ring: THREE.Vector3[] = [start.clone()];
    let current = start;
    let currentKey = startKey;

    const verbose = ringIndex < 3; // Only log first 3 rings in detail
    if (verbose) {
      console.log(`\n[Ring ${ringIndex}] Starting from vertex:`, startKey);
    }

    let debugSteps = 0;
    let terminationReason = 'unknown';

    // Walk the graph
    for (let step = 0; step < edges.length * 2; step++) {
      debugSteps++;
      const currentNeighbors = graph.get(currentKey);

      if (!currentNeighbors || currentNeighbors.length === 0) {
        terminationReason = 'no neighbors';
        break;
      }

      if (verbose && step < 10) {
        console.log(`  Step ${step}: at ${currentKey}, neighbors:`, currentNeighbors.length);
      }

      // Choose next unvisited neighbor
      let next: THREE.Vector3 | null = null;
      let nextKey: string | null = null;

      for (const neighbor of currentNeighbors) {
        const nKey = makeVertexKey(neighbor, tolerance);
        const edgeKey = makeEdgeKeyDirected(currentKey, nKey);

        if (!visitedEdges.has(edgeKey)) {
          next = neighbor;
          nextKey = nKey;
          // Mark BOTH directions as visited (undirected edge)
          visitedEdges.add(edgeKey);
          visitedEdges.add(makeEdgeKeyDirected(nKey, currentKey)); // Reverse direction
          if (verbose && step < 10) {
            console.log(`    → Chose neighbor: ${nKey} (marked both directions)`);
          }
          break;
        }
      }

      if (!next || !nextKey) {
        terminationReason = 'no unvisited neighbors';
        if (verbose) {
          console.log(`  Terminated: all neighbors visited`);
        }
        break;
      }

      // Check if we closed the ring (compare keys, not raw positions!)
      if (nextKey === startKey) {
        ring.push(start.clone()); // Close the ring
        terminationReason = 'closed ring';
        if (verbose) {
          console.log(`  Closed ring! Returned to start after ${debugSteps} steps`);
        }
        break;
      }

      ring.push(next.clone());
      current = next;
      currentKey = nextKey;

      if (step === edges.length * 2 - 1) {
        terminationReason = 'max steps reached';
      }
    }

    // Only keep closed rings with at least 3 vertices
    const isClosed = ring[0].distanceTo(ring[ring.length - 1]) < tolerance;
    const isLargeEnough = ring.length >= 4;

    if (isLargeEnough && isClosed) {
      console.log(`[Ring ${ringIndex}] ✓ ACCEPTED: ${ring.length} vertices, ${debugSteps} steps, reason: ${terminationReason}`);
      rings.push(ring);
      ringIndex++;
    } else {
      if (verbose) {
        console.log(`[Ring ${ringIndex}] ✗ REJECTED: ${ring.length} vertices, ${debugSteps} steps, reason: ${terminationReason}`);
        console.log(`  Closed: ${isClosed}, Large enough: ${isLargeEnough}`);
        if (!isClosed) {
          console.log(`  Start-end distance: ${ring[0].distanceTo(ring[ring.length - 1]).toFixed(6)} (tolerance: ${tolerance})`);
        }
      }
      ringIndex++;
    }
  }

  console.log('[orderEdgesIntoRings] Final:', rings.length, 'rings');
  return rings;
}

function makeVertexKey(v: THREE.Vector3, tolerance: number): string {
  const snap = (val: number) => Math.round(val / tolerance) * tolerance;
  return `${snap(v.x)},${snap(v.y)},${snap(v.z)}`;
}

function makeEdgeKeyDirected(keyA: string, keyB: string): string {
  return `${keyA}->${keyB}`;
}

/**
 * Project 3D rings to UV space.
 */
function projectRingsToUV(
  rings3D: THREE.Vector3[][],
  origin: THREE.Vector3,
  uDir: THREE.Vector3,
  vDir: THREE.Vector3
): UV[][] {
  const uNorm = uDir.clone().normalize();
  const vNorm = vDir.clone().normalize();

  return rings3D.map(ring => {
    return ring.map(point => {
      const d = new THREE.Vector3().subVectors(point, origin);
      const u = d.dot(uNorm);
      const v = d.dot(vNorm);
      return [u, v] as UV;
    });
  });
}

/**
 * Simplify rings using RDP algorithm and axis snapping.
 */
function simplifyRings(rings: UV[][], params: ExtractionParams): UV[][] {
  return rings.map((ring, idx) => {
    console.log(`[simplifyRings] Ring ${idx}: Starting with ${ring.length} vertices`);

    // RDP simplification
    let simplified = rdpSimplify(ring, params.simplifyEps);
    console.log(`[simplifyRings] Ring ${idx}: After RDP (eps=${params.simplifyEps}): ${simplified.length} vertices`);

    // Axis snapping
    simplified = axisSnapSegments(simplified, params.snapDeg);
    console.log(`[simplifyRings] Ring ${idx}: After axis snap: ${simplified.length} vertices`);

    // Deduplicate near-coincident vertices
    simplified = dedupeVertices(simplified, params.vertexMergeEps);
    console.log(`[simplifyRings] Ring ${idx}: After dedupe: ${simplified.length} vertices`);

    // Ensure closed
    simplified = ensureClosed(simplified, params.vertexMergeEps);
    console.log(`[simplifyRings] Ring ${idx}: After close: ${simplified.length} vertices`);
    console.log(`[simplifyRings] Ring ${idx}: Final vertices:`, simplified);

    return simplified;
  });
}

/**
 * Ramer-Douglas-Peucker line simplification.
 */
function rdpSimplify(points: UV[], epsilon: number): UV[] {
  if (points.length <= 2) return points;

  const first = points[0];
  const last = points[points.length - 1];

  // Find point with max distance from line
  let maxDist = 0;
  let maxIndex = 0;

  for (let i = 1; i < points.length - 1; i++) {
    const dist = perpendicularDistance(points[i], first, last);
    if (dist > maxDist) {
      maxDist = dist;
      maxIndex = i;
    }
  }

  if (maxDist > epsilon) {
    // Recursive split
    const left = rdpSimplify(points.slice(0, maxIndex + 1), epsilon);
    const right = rdpSimplify(points.slice(maxIndex), epsilon);
    return [...left.slice(0, -1), ...right];
  } else {
    return [first, last];
  }
}

function perpendicularDistance(point: UV, lineStart: UV, lineEnd: UV): number {
  const [px, py] = point;
  const [x1, y1] = lineStart;
  const [x2, y2] = lineEnd;

  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;

  if (lenSq < 1e-10) {
    return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);
  }

  const t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;

  return Math.sqrt((px - projX) ** 2 + (py - projY) ** 2);
}

/**
 * Snap segments to axis-aligned if within angle threshold.
 */
function axisSnapSegments(points: UV[], snapDegrees: number): UV[] {
  if (points.length < 2) return points;

  const snapRadians = (snapDegrees * Math.PI) / 180;
  const snapped: UV[] = [points[0]];

  for (let i = 1; i < points.length; i++) {
    const prev = snapped[snapped.length - 1];
    const curr = points[i];

    const dx = curr[0] - prev[0];
    const dy = curr[1] - prev[1];
    const len = Math.sqrt(dx * dx + dy * dy);

    if (len < 1e-6) continue; // Skip zero-length segments

    const angle = Math.atan2(dy, dx);
    const absAngle = Math.abs(angle);

    // Check if close to 0°, 90°, 180°, or 270°
    const snapToHorizontal = absAngle < snapRadians || absAngle > Math.PI - snapRadians;
    const snapToVertical = Math.abs(absAngle - Math.PI / 2) < snapRadians;

    if (snapToHorizontal) {
      snapped.push([curr[0], prev[1]]);
    } else if (snapToVertical) {
      snapped.push([prev[0], curr[1]]);
    } else {
      snapped.push(curr);
    }
  }

  return snapped;
}

/**
 * Deduplicate vertices that are closer than tolerance.
 */
function dedupeVertices(points: UV[], tolerance: number): UV[] {
  if (points.length === 0) return points;

  const deduped: UV[] = [points[0]];

  for (let i = 1; i < points.length; i++) {
    const prev = deduped[deduped.length - 1];
    const curr = points[i];

    const dist = Math.sqrt((curr[0] - prev[0]) ** 2 + (curr[1] - prev[1]) ** 2);
    if (dist > tolerance) {
      deduped.push(curr);
    }
  }

  return deduped;
}

/**
 * Ensure ring is closed (first point equals last point).
 */
function ensureClosed(points: UV[], tolerance: number): UV[] {
  if (points.length < 2) return points;

  const first = points[0];
  const last = points[points.length - 1];
  const dist = Math.sqrt((first[0] - last[0]) ** 2 + (first[1] - last[1]) ** 2);

  if (dist > tolerance) {
    return [...points, first];
  }

  return points;
}

/**
 * Choose outer ring (largest area) and holes (rest).
 */
function chooseOuterAndHoles(rings: UV[][]): PolygonRings {
  if (rings.length === 0) {
    return { outer: [], holes: [] };
  }

  // Sort by absolute area (largest first)
  const sorted = rings
    .map(ring => ({ ring, area: Math.abs(signedArea(ring)) }))
    .sort((a, b) => b.area - a.area);

  const outer = sorted[0].ring;
  const holes = sorted.slice(1).map(r => r.ring);

  // Enforce winding: outer CCW, holes CW
  if (signedArea(outer) < 0) outer.reverse();
  for (const hole of holes) {
    if (signedArea(hole) > 0) hole.reverse();
  }

  return { outer, holes };
}

/**
 * Compute signed area of polygon (positive = CCW, negative = CW).
 */
function signedArea(points: UV[]): number {
  let area = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[i + 1];
    area += x1 * y2 - x2 * y1;
  }
  return area / 2;
}

/**
 * Extract silhouette from closed mesh triangles.
 * For closed meshes (like L-shaped desks with top/bottom faces), we project and
 * cluster triangle vertices, identify boundary edges in UV space, and reuse the
 * ring-ordering/simplification pipeline to recover the concave outline.
 */
function extractSilhouetteFromTriangles(
  triangles: Triangle[],
  planeOrigin: THREE.Vector3,
  uDir: THREE.Vector3,
  vDir: THREE.Vector3,
  params: ExtractionParams
): PolygonRings | null {
  const LOG_TAG = '[polygonFallback]';
  console.log(`${LOG_TAG} processing ${triangles.length} coplanar triangles`);

  if (triangles.length === 0) {
    console.warn(`${LOG_TAG} no triangles supplied`);
    return null;
  }

  // Normalise projection axes so UV coordinates represent metres along each axis.
  const uNorm = uDir.clone().normalize();
  const vNorm = vDir.clone().normalize();

  const clusterTol = Math.max(params.vertexMergeEps, 1e-5);
  const clusters = new Map<string, {
    index: number;
    sumU: number;
    sumV: number;
    count: number;
  }>();
  const clusterList: {
    index: number;
    sumU: number;
    sumV: number;
    count: number;
  }[] = [];

  const quantise = (value: number) =>
    Math.round(value / clusterTol) * clusterTol;

  const getClusterIndex = (point: UV) => {
    const key = `${quantise(point[0])},${quantise(point[1])}`;
    let cluster = clusters.get(key);
    if (!cluster) {
      cluster = { index: clusterList.length, sumU: 0, sumV: 0, count: 0 };
      clusters.set(key, cluster);
      clusterList.push(cluster);
    }
    cluster.sumU += point[0];
    cluster.sumV += point[1];
    cluster.count += 1;
    return cluster.index;
  };

  type TriangleIndices = [number, number, number];
  const triIndices: TriangleIndices[] = [];

  const projectToUV = (point: THREE.Vector3): UV => {
    const rel = new THREE.Vector3().subVectors(point, planeOrigin);
    return [rel.dot(uNorm), rel.dot(vNorm)];
  };

  for (const tri of triangles) {
    const aUV = projectToUV(tri.a);
    const bUV = projectToUV(tri.b);
    const cUV = projectToUV(tri.c);

    const ia = getClusterIndex(aUV);
    const ib = getClusterIndex(bUV);
    const ic = getClusterIndex(cUV);

    triIndices.push([ia, ib, ic]);
  }

  if (clusterList.length < 3) {
    console.warn(`${LOG_TAG} insufficient unique vertices after clustering`, {
      unique: clusterList.length,
    });
    return null;
  }

  const vertices: UV[] = clusterList.map(cluster => [
    cluster.sumU / cluster.count,
    cluster.sumV / cluster.count,
  ] as UV);

  const makeEdgeKey = (a: number, b: number) =>
    a < b ? `${a}-${b}` : `${b}-${a}`;
  const makeDirectedKey = (a: number, b: number) => `${a}->${b}`;

  const directedCounts = new Map<string, number>();
  const undirectedEdges = new Map<string, { min: number; max: number }>();

  const registerDirectedEdge = (from: number, to: number) => {
    if (from === to) return;
    const dirKey = makeDirectedKey(from, to);
    directedCounts.set(dirKey, (directedCounts.get(dirKey) || 0) + 1);

    const key = makeEdgeKey(from, to);
    if (!undirectedEdges.has(key)) {
      undirectedEdges.set(key, { min: Math.min(from, to), max: Math.max(from, to) });
    }
  };

  for (const [ia, ib, ic] of triIndices) {
    registerDirectedEdge(ia, ib);
    registerDirectedEdge(ib, ic);
    registerDirectedEdge(ic, ia);
  }

  const boundaryEdges: { a: number; b: number }[] = [];
  for (const edge of undirectedEdges.values()) {
    const forward = directedCounts.get(makeDirectedKey(edge.min, edge.max)) || 0;
    const reverse = directedCounts.get(makeDirectedKey(edge.max, edge.min)) || 0;

    if (forward === 0 || reverse === 0) {
      // Use whichever orientation exists so ordering has consistent direction.
      boundaryEdges.push({
        a: forward > 0 ? edge.min : edge.max,
        b: forward > 0 ? edge.max : edge.min,
      });
    }
  }

  if (boundaryEdges.length === 0) {
    console.warn(`${LOG_TAG} failed to isolate boundary edges`, {
      uniqueVertices: vertices.length,
      edgeCount: undirectedEdges.size,
    });
    return null;
  }

  console.log(`${LOG_TAG} clustered vertices: ${vertices.length}, boundary edges: ${boundaryEdges.length}`);

  // Convert boundary edges into THREE vectors so we can reuse existing ordering logic.
  const edgeVectors: Edge[] = boundaryEdges.map(({ a, b }) => ({
    a: new THREE.Vector3(vertices[a][0], vertices[a][1], 0),
    b: new THREE.Vector3(vertices[b][0], vertices[b][1], 0),
  }));

  const rings3D = orderEdgesIntoRings(edgeVectors, params.vertexMergeEps);
  if (rings3D.length === 0) {
    console.warn(`${LOG_TAG} ordering failed`, {
      vertices: vertices.length,
      boundaryEdges: boundaryEdges.length,
    });
    return null;
  }

  const ringsUV = rings3D.map(ring =>
    ring.map(point => [point.x, point.y] as UV)
  );

  const closedRings = ringsUV.map(ring =>
    ensureClosed(ring, params.vertexMergeEps)
  );

  const simplified = simplifyRings(closedRings, params);
  const result = chooseOuterAndHoles(simplified);

  if (result.outer.length < 3) {
    console.warn(`${LOG_TAG} extraction yielded degenerate polygon`, {
      outer: result.outer.length,
    });
    return null;
  }

  console.log(`${LOG_TAG} success`, {
    outerVertices: result.outer.length,
    holeCount: result.holes.length,
  });

  return result;
}

