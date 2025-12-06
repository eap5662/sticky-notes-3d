## Current Focus

- Docking logic still misinterprets desk surface polygons: `SurfaceMeta.shape.points` are in surface-space meters (not normalized UV), so helpers like `clampUVToShape`, `isUVInsideSurface`, and `getSurfaceSpawnPoint` need to normalize against the true U/V ranges before running point-in-polygon or clamping logic.
- **Why the visualization is right:** `DeskSurfaceBoundsMarkers` consumes the raw `SurfaceMeta` and reconstructs corners using `origin`, `uAxis`, `vAxis`, and `shape.points`. Because those points live in the same surface-space coordinate system (meters along the U/V axes), the overlay correctly matches the desk geometry—no normalization is attempted, so there’s no reflection/scale error. We must replicate that interpretation for docking.

## Key Artifacts

- `apps/web/src/canvas/math/surfaceFrame.ts`: existing helpers for projection/clamping. Needs the normalization fix (compute min/max per axis, map to normalized space, run point-in-polygon, remap back).
- `apps/web/src/canvas/GenericPropControls.tsx`: spawning props uses `getSurfaceSpawnPoint`; update once the helper is fixed.
- `apps/web/src/canvas/props/GenericProp.tsx` and `apps/web/src/canvas/LayoutControls.tsx`: both gate interaction/docking using `isUVInsideSurface` & `clampUVToShape`.

## Observed Data (Tan Desk)

From the diagnostic script (now removed after use, recreated if needed):

- `origin`: `[-0.72447538, 0.38440761, -0.01000001]`
- `uAxis`: `[0.73447537, 0, 0]` (positive X)
- `vAxis`: `[0, 0, -0.39000000]` (negative Z)
- `shape.points`: `[(0.734..., -0.390...), (0.734..., 0), (0,0), (0,-0.390...), ...]`
- Polygon spans `u ∈ [0, 0.734…]`, `v ∈ [-0.390…, 0]` in surface-space meters; when normalized it becomes `u ∈ [0,1]`, `v ∈ [-1,0]`. The visualization plugs those values straight into `origin + uAxis*u + vAxis*v`, so it lands exactly on the mesh.

## Next Steps for the Follow-up Agent

1. Refactor `surfaceFrame.ts` as noted above (normalize polygon space, update clamp/inside/centroid helpers).
2. Re-run lint/tests as feasible (`pnpm -C apps/web lint` still fails due to pre-existing hook issues—safe to ignore for now, but note them).
3. Confirm behavior manually or via a quick diagnostic: props should spawn/dock inside the red plane on Tan Desk and respect the cut-out on the L-shaped desk.

Note: `scripts/debug-surface.ts` was a temporary local utility; recreate it if deeper surface inspection is required. Use the coordinates captured above as reference.***
