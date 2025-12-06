# Desk Surface Hidden Mirror Workaround

## Problem Overview

Certain GLTF desks expose surface metadata (`origin`, `uAxis`, `vAxis`, `shape.points`) where the extracted polygon spans a larger range than the visible mesh. When we convert those raw points into normalized UVs we unintentionally pick up a *reflected* copy of the surface on the far side of the U/V axes. The overlay renderer (`DeskSurfaceBoundsMarkers`) only draws the true polygon, but the docking math historically treated both halves as valid. Users could therefore park props in the “invisible” mirror and only discover the mistake after docking.

### Why it happens

1. The polygon extraction routine returns surface‐space coordinates in meters.
2. Some desks use negative values for one axis (e.g., V ranges `[-0.39, 0]`).
3. Our old normalization assumed `[0,1]` always mapped to the full axis length; we effectively mirrored the polygon across the axis origin.
4. Docking helpers (`isUVInsideSurface`, `clampUVToShape`) operated on those mirrored values, while the visualization did not—creating a hidden, valid docking zone.

## Workaround (February 2026)

We now:

1. **Normalize using projected ranges** – The polygon is reprojected via `projectPointToSurface`, producing `projectedURange` and `projectedVRange`. All clamping/inside checks happen in that normalized space.
2. **Shared conversion helpers** – `normalizedUVToProjected` converts the normalized values back to surface meters only at the point we unproject.
3. **UI guardrail** – In `GenericProp.tsx` and `LayoutControls.tsx`, if a polygon surface reports `isUVInsideSurface === false`, we treat the prop as “off desk.” The Dock button renders disabled with the standard “Move prop over desk surface to dock” message, masking the hidden hole from users.
4. **No fallback for polygons** – The legacy 0‑1 fallback now only applies to rectangular desks. Polygon desks never use it, so the mirror is unreachable through the UI.

This *does not* fix the underlying metadata; it simply hides the phantom region and prevents docking there.

## What To Watch Out For

- **Prop remapping / desk swap** – Restoring saved attachments still runs through the new conversion helpers. If a stored attachment contained out‑of‑range UVs (from older sessions), we clamp it into the visible polygon before unprojecting.
- **Spawn points & auto placement** – `getSurfaceSpawnPoint` now normalizes first, so seed positions land inside the same bounds as the overlay.
- **Visualization** – The fill mesh in `DeskSurfaceBoundsMarkers` uses normalized vertices scaled by the actual projected span. If the mesh looks stretched, double-check that the polygon ranges are correct before tweaking the workaround.
- **Future Surfaces** – If a new desk exhibits the mirror, the logging that once highlighted it has been removed. You can temporarily re-enable logging in `surfaceFrame.ts` if you need diagnostic output (`isUVInsideSurface` already returns `false` when outside the polygon).

## Recommended Fix (Future Work)

Long-term we should address the metadata itself:

- Treat the surface frame as a true affine transform matrix (origin + basis) and transform polygon vertices explicitly.
- Encode the valid U/V ranges alongside the metadata so downstream systems don’t need to infer them.
- Add validation scripts that compare the mesh bounds and polygon ranges to catch mirrors during asset import.

Until then, the guardrail keeps the UX consistent—if the Dock button is enabled, docking succeeds; if it’s disabled, users receive the standard hint and can’t fall into the hidden hole. Just remember that the hidden geometry still exists in surface-space math, so any new feature reading raw `shape.points` must normalize via the shared helpers.***
