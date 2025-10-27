# Desk Surface Bounds Marking - Status & Progress

## Current State (2025-10-26)

The desk surface bounds marking system has been implemented with **Tier B (automatic polygon extraction)** working successfully for most desk types, with partial support for L-shaped desks.

### ✅ Working (Fully Functional)

1. **Curved/Organic Desks** (e.g., curved desk with 120+ vertices)
   - Tier B boundary edge extraction works perfectly
   - Extracts 35-point polygon from 121 boundary vertices
   - Simplification and axis-snapping produce clean outline
   - Handles rotation, scale, drag transformations

2. **Simple Rectangular Desks** (e.g., Tan desk)
   - Tier B boundary edge extraction works
   - Produces 5-point polygon (4 corners + closing vertex)
   - All coordinate transformations working correctly

3. **Monitor/Curved Surface Desks** (tested with Grey Computer Desk)
   - Polygon extraction working
   - Bounds rendering accurate

### ⚠️ Partially Working (Needs Refinement)

**L-Shaped Desks** (e.g., Modified Corner Desk)
- **Status:** Desk is recognized as workspace (no more 'No Workspace Active' banner)
- **Current Behavior:**
  - Successfully detects 6 corner vertices
  - Orthogonal L reconstruction algorithm detects 3×3 grid correctly
  - Identifies missing corner (bite location) correctly
  - Produces an L-shaped outline, but **not perfectly accurate to actual desk geometry**
  - Logs show: `[reconstructL] Unique U values: 3`, `Unique V values: 3`, `Missing corner: [...] (bite location)`

**Known Issues with L-Shape:**
- The reconstructed L-shape is "somewhat closer to correct, but not accurate"
- Likely causes:
  - Axis snapping may be over-aggressive for non-perfectly-orthogonal L-shapes
  - 3×3 grid assumption may not match actual vertex positions after rotation/scale
  - Missing corner detection logic may need refinement for rotated desks
  - Vertex ordering in the lookup table may need adjustment

## Architecture: Tiered Extraction System

### Tier A: Authored Shapes (Manual)
- **Status:** Implemented but not recommended
- **Use case:** Manual polygon definition in `propCatalog.ts`
- **Pros:** 100% reliable, designer knows exact shape
- **Cons:** Requires manual work per desk, not scalable, rejected by user

### Tier B: Automatic Polygon Extraction (Current Focus)
- **Status:** Working for open meshes, partial for closed meshes
- **Algorithm Flow:**
  1. Collect coplanar triangles (filtering by normal direction)
  2. Extract boundary edges (edges used by only 1 triangle)
  3. Order edges into rings
  4. Project to UV space, simplify, snap to axes
  5. **Fallback for closed meshes:** Orthogonal L reconstruction or centroid-based sorting

**Tier B Sub-strategies for Closed Meshes:**
- **Orthogonal L Reconstruction:** For axis-aligned L-shapes with 6 vertices on 3×3 grid
- **Centroid-based Sorting:** Sort vertices by angle around centroid (works for star-shaped polygons)
- **Convex Hull (deprecated):** Fills concavities, wrong for L-shapes

### Tier C: Rect Fallback
- **Status:** Always available as final fallback
- Uses bounding box from surface extents

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

### 3. Orthogonal L-Shape Reconstruction Algorithm
**Problem:** Convex hull fills the concave corner of L-shapes.

**Solution:** Implemented grid-based reconstruction algorithm:

**Algorithm:**
1. Project 6 corner vertices to UV space
2. Snap to axis-aligned (0°/90°)
3. Extract 3 unique U values and 3 unique V values (3×3 grid)
4. Detect which corner of bounding rectangle is missing (the 'bite')
5. Emit 6 vertices in CCW order based on bite location

**Lookup Table:**
```typescript
switch (missingCorner) {
  case (x0,y0): order = [(x0,y2),(x0,y1),(x1,y1),(x1,y0),(x2,y0),(x2,y2)]  // bite bottom-left
  case (x2,y0): order = [(x0,y0),(x2,y0),(x2,y1),(x1,y1),(x1,y2),(x0,y2)]  // bite bottom-right
  case (x2,y2): order = [(x0,y0),(x2,y0),(x2,y2),(x1,y2),(x1,y1),(x0,y1)]  // bite top-right
  case (x0,y2): order = [(x0,y0),(x2,y0),(x2,y2),(x0,y2),(x0,y1),(x1,y1)]  // bite top-left
}
```

**File:** `apps/web/src/canvas/math/polygonGeometry.ts:691-776`

**Result:** L-shape is recognized and extracted, but not perfectly accurate to actual desk geometry.

---

### 4. Centroid-Based Sorting Fallback
**Purpose:** Handle cases where orthogonal L reconstruction fails (non-axis-aligned, wrong vertex count, etc.)

**Algorithm:**
1. Compute centroid of all vertices
2. Sort vertices by angle around centroid (atan2)
3. Close the loop

**File:** `apps/web/src/canvas/math/polygonGeometry.ts:782-815`

**Result:** Works for star-shaped polygons, provides graceful degradation.

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

1. **L-Shaped Desks (Closed Meshes):**
   - Orthogonal L reconstruction produces approximate shape, not pixel-perfect
   - Assumes 3×3 grid structure (may not hold for rotated/scaled desks)
   - Axis snapping may over-simplify non-orthogonal L-shapes

2. **Complex Concave Shapes:**
   - No general concave hull implementation
   - Falls back to convex hull (loses concavities)
   - May require Tier A (manual authoring) for complex shapes

3. **Performance:**
   - Polygon extraction runs on every surface metadata update
   - Re-extracts on rotation, scale changes
   - Could be optimized with caching

## Next Steps for L-Shape Refinement

1. **Debug Orthogonal L Reconstruction:**
   - Log actual vertex positions vs. reconstructed positions
   - Check if axis snapping is too aggressive
   - Verify grid detection handles rotated desks correctly
   - Test with multiple L-shaped desk models

2. **Alternative Approaches:**
   - Implement proper concave hull / alpha shape algorithm
   - Use triangle edge walking (if silhouette edges can be identified)
   - Consider machine learning approach to detect shape from vertices

3. **Fallback Strategy:**
   - Document limitation in user-facing docs
   - Suggest users create desk models with separate top face (open mesh)
   - Provide Tier A template for common L-shape orientations

## Testing Status

### ✅ Tested & Working
- Curved desk (35 vertices from 121 boundary edges)
- Tan desk (5 vertices, rectangular)
- Grey Computer Desk (curved surface)
- Rotation transforms (all desks)
- Scale transforms (all desks)
- Chirality fix (no more mirroring)

### ⚠️ Needs More Testing
- L-shaped desk accuracy refinement
- Multiple L-desk models with different proportions
- L-desks at various rotation angles
- U-shaped desks, C-shaped desks (concave shapes)
- Drag transforms (lower priority)

### ❌ Not Tested
- Desks with holes (inner rings)
- Very complex organic shapes
- Performance with many desks
- Memory usage / cleanup

## Debug Logging

Extensive debug logging is currently active in:
- `polygonGeometry.ts` - All extraction steps
- `surfaceAdapter.ts` - Tier A/B/C selection
- `DeskSurfaceBoundsMarkers.tsx` - Chirality checks, rotation calculation

**TODO:** Clean up debug logging before production (keep key milestone logs, remove verbose step-by-step).

## References

- **Chirality Issue Discussion:** October 26, 2025 session
- **Orthogonal L Algorithm Suggestion:** User-provided algorithm in conversation
- **Convex Hull Failure:** Tested and rejected, logs available
