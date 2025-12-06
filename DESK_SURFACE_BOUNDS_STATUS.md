# Desk Surface Bounds Marking - Status & Progress

## Current State (2025-10-26)

The desk surface bounds system now relies solely on the automatic extractor plus the new closed-mesh boundary-walk fallback. Rectangular, curved, and modified corner (L) desks all yield accurate polygons; only drag-time drift remains under investigation.

### ✅ Working (Fully Functional)

1. **Curved/Organic Desks** (e.g., curved desk with hundreds of vertices)
   - Boundary edge extraction works perfectly
   - Extracts 35-point polygon from 121 boundary vertices
   - Simplification and axis-snapping produce clean outline
   - Handles rotation, scale, drag transformations

2. **Simple Rectangular Desks** (e.g., Tan desk, Grey Computer Desk)
   - Boundary edge extraction works
   - Produces 5-point polygon (4 corners + closing vertex)
   - All coordinate transformations working correctly

3. **Closed-Mesh Desks** (e.g., Modified Corner Desk)
   - Boundary-walk fallback reconstructs correct 6-point L outline
   - Tracks rotation/scale updates without manual intervention


### ⚠️ Partially Working (Needs Refinement)
- Dragging desks causes polygon markers to drift ahead of geometry (see "Transform Drift While Dragging" below).

## Architecture Overview

### Primary Extraction (Open Meshes)
- **Status:** Stable for desks with exposed top faces (rectangular, curved).
- **Pipeline:**
  1. Collect coplanar triangles aligned with the surface normal.
  2. Extract boundary edges (single-triangle usage).
  3. Order edges into rings and project into UV space.
  4. Simplify with RDP, snap near-orthogonal segments, dedupe, and ensure closure.

### Closed-Mesh Fallback (Tessellated Tops)
- **Status:** New boundary-walk solution (2025-10-26); handles L-shaped desks and any closed planar mesh.
- **Pipeline:**
  1. Project triangle vertices into UV using normalized axes.
  2. Cluster near-coincident UV points to recover canonical vertices.
  3. Track directed edge usage; edges missing a counter-wound partner are treated as boundary.
  4. Reuse the core ring-ordering + simplification flow for final polygon output.
- **Notes:** Sensitive to `vertexMergeEps` tolerance; tune if future assets are noisier.

### Rect Fallback
- **Status:** Final safety net when polygon extraction fails.
- **Implementation:** Uses surface extents to emit planar rectangle (unchanged).

## Key Fixes Implemented

### 1. Chirality Fix (Coordinate System Handedness)
**Problem:** Planes appeared mirrored/reflected over an axis for some desks.

**Root Cause:** `surfaceAdapter.ts` was flipping the `normal` vector to align with thickness direction, but not also flipping `vDir`, which broke the right-handed coordinate system:
```
uDir × vDir ≠ normal  (left-handed system)
```

**Fix:** Also flip `vDir` when flipping `normal` to maintain `uDir × vDir = normal`:
```typescript
if (alignSign < 0) {
  normalDir.multiplyScalar(-1);
  vDir.multiplyScalar(-1);  // ADDED
}
```

**File:** `apps/web/src/canvas/props/surfaceAdapter.ts:196-203`

**Result:** All desk planes now render with correct orientation (no more mirroring).

---

### 2. Triangle Normal Direction Filtering
**Problem:** L-shaped desk showed "No boundary edges found" because both top and bottom faces were being collected, creating a closed mesh.

**Root Cause:** `collectCoplanarTriangles()` used `Math.abs(dot)` which accepted triangles pointing in **either direction**.

**Fix:** Remove `Math.abs()` to only accept triangles pointing **same direction** as plane normal:
```typescript
// Before:
const dot = Math.abs(triNormal.dot(planeNormal));

// After:
const dot = triNormal.dot(planeNormal);
if (dot < Math.max(params.normalDotMin, 0.9)) continue;
```

**File:** `apps/web/src/canvas/math/polygonGeometry.ts:156-157`

**Result:** Only top face triangles collected, but L-shaped desk still has no boundary edges (surface is tessellated/triangulated with all interior edges).

---

### 3. Closed-Mesh Boundary Walk
**Problem:** L-shaped desk surfaced as a closed mesh; prior grid/centroid heuristics produced distorted outlines or failed outright.

**Solution:** Project triangles into UV space, cluster coincident points, record directed edge usage, and treat edges lacking an opposite direction as the true perimeter before feeding the existing ring simplifier.

**File:** `apps/web/src/canvas/math/polygonGeometry.ts` (fallback in `extractSilhouetteFromTriangles`)

**Result:** Modified corner desk now yields a six-vertex polygon aligned with the real geometry; works for any planar concave shape.

---

### 4. Bounds Marker Translation Fix
**Problem:** Overlay polygon drifted during drags because desk position was added twice (once baked into metadata, once during rendering).

**Solution:** Stop re-applying `deskProp.position` when constructing marker corners.

**File:** `apps/web/src/canvas/DeskSurfaceBoundsMarkers.tsx`

**Result:** Polygon markers now remain locked to the desk while dragging.

---

### 5. Removed Manual Tier & Legacy Helpers
**Problem:** Tier A (`authoredPolygon`) and the legacy L-shape helpers increased complexity without being used.

**Fix:** Deleted the manual polygon option from `surfaceAdapter.ts` and removed deprecated reconstruction/hull helpers from `polygonGeometry.ts`.

**Result:** Desk bounds flow relies solely on the automatic extractor with consistent logging and fewer code paths to maintain.

## Approaches Tried That Failed

### ❌ Convex Hull for L-Shapes
**Attempted:** Use Gift Wrapping (Jarvis March) to compute convex hull of vertices.

**Why It Failed:** Convex hull **fundamentally fills concavities**. For an L-shape, it connects the vertices in a way that creates a convex polygon (triangle or pentagon), losing the L-shape's concave corner.

**Evidence:** Logs showed 6 vertices → 6-vertex convex hull, but visual result was triangular/pentagonal, not L-shaped.

**Conclusion:** Convex hull is the **wrong algorithm** for any concave shape (L, U, C, etc.).

---

### ❌ Concave Hull / Alpha Shape (Not Implemented)
**Consideration:** Use alpha shapes or concave hull algorithm to preserve concavities.

**Why Not Implemented:**
- Complex algorithm with tuning parameters (alpha value)
- Uncertain whether it would work for closed, tessellated meshes
- Grid-based reconstruction approach was simpler and more deterministic

**Status:** Documented as potential future improvement if grid approach proves insufficient.

---

### ❌ Edge Perimeter Detection for Closed Meshes
**Attempted:** For closed meshes, try to detect 'perimeter' edges by analyzing triangle topology.

**Why It Failed:** For a tessellated surface (many small triangles forming the L-shape), all edges are **interior edges** (shared by 2+ triangles). There's no topological distinction between 'perimeter' and 'interior' when viewing a single flat surface of a closed mesh.

**Evidence:** Edge usage histogram showed `[[2, 6], [4, 3]]` - 6 edges used by 2 triangles, 3 edges by 4 triangles. No edges used by only 1 triangle (no boundary).

**Conclusion:** Cannot extract silhouette from topology alone for closed, tessellated meshes.

---

### ❌ Using Both Top and Bottom Faces
**Attempted:** Original implementation used `Math.abs(dot)` to accept triangles pointing in either direction.

**Why It Failed:** Collected both top and bottom faces of L-shaped desk, creating a fully closed mesh with no boundary edges. Edge extraction failed completely.

**Evidence:** Edge histogram showed all edges shared by 2+ triangles.

**Fix:** Changed to only accept triangles pointing in same direction as desired normal (removed `Math.abs()`).

## Technical Details

### Coordinate Spaces
- **World Space:** Global 3D coordinates after all transformations
- **GLTF-Local Space:** Node's local coordinate system (includes node's matrixWorld)
- **UV Space:** 2D projection onto surface plane (origin, uDir, vDir basis)
- **Normalized UV:** UV coordinates divided by extents (0-1 range for geometry)

### Transform Hierarchy
```
Surface Metadata (GLTF-local space, includes node.matrixWorld)
  ↓
Desk Position Added (world space)
  ↓
Outline Rendering: origin + uAxis*u + vAxis*v
Geometry Rendering: normalized (0-1) vertices, scaled by extents, positioned at origin
```

### Key Files
- **Polygon Extraction:** `apps/web/src/canvas/math/polygonGeometry.ts`
- **Surface Adaptation:** `apps/web/src/canvas/props/surfaceAdapter.ts`
- **Bounds Rendering:** `apps/web/src/canvas/DeskSurfaceBoundsMarkers.tsx`
- **Prop Catalog:** `apps/web/src/data/propCatalog.ts`

## Known Limitations

1. **Concave Shapes Beyond L**
   - Boundary walk is validated on the modified corner desk; U-/C-shaped desks still untested.
   - Current simplifier assumes a single outer ring; inner voids/holes remain unsupported.

2. **Performance**
   - Polygon extraction runs on every surface metadata update
   - Re-extracts on rotation, scale changes
   - Could be optimized with caching

## Next Steps

1. **Validate Closed-Mesh Fallback**
   - Test additional concave desks (U, C, multi-bite) and rotated variants.
   - Add unit/integration snapshots for representative meshes if feasible.

2. **Verify Drag Alignment**
   - Manually test long-distance drags on multiple desks to confirm overlays remain locked.
   - Add regression notes/tests so future refactors keep metadata/world-space alignment intact.

3. **Performance / Logging Hygiene**
   - Evaluate caching strategy or throttling for rapid updates.
   - Trim verbose logs once investigations finish (retain tagged summaries).

## Testing Status

### ✅ Tested & Working
- Curved desk (35 vertices from 121 boundary edges)
- Tan desk (5 vertices, rectangular)
- Grey Computer Desk (curved surface)
- Modified corner desk (closed mesh L-shape; 6-point polygon)
- Rotation transforms (all desks)
- Scale transforms (all desks)
- Chirality fix (no more mirroring)

### ⚠️ Needs More Testing
- Additional concave desks (U/C shapes, multi-level bites)
- Closed meshes with higher tessellation/noise
- U-shaped desks, C-shaped desks (concave shapes)

### ❌ Not Tested
- Desks with holes (inner rings)
- Very complex organic shapes
- Performance with many desks
- Memory usage / cleanup

## Debug Logging

Extensive debug logging is currently active in:
- `polygonGeometry.ts` - All extraction steps
- `surfaceAdapter.ts` - Extraction success/failure summaries
- `DeskSurfaceBoundsMarkers.tsx` - Chirality checks, rotation calculation

**TODO:** Clean up debug logging before production (keep key milestone logs, remove verbose step-by-step).

## References

- **Chirality Issue Discussion:** October 26, 2025 session
- **Boundary Walk Fallback:** Implemented October 26, 2025 session
- **Convex Hull Failure:** Tested and rejected, logs archived
