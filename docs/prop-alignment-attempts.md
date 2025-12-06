# Prop Alignment Mini-Sprint (October 2025)

## Goal
Have every newly spawned prop appear already facing the active camera so users no longer need to rotate items immediately after dropping them. Alignment for desks was optional; primary target was accessories, electronics, etc.

## Attempt 1 – Catalog-Time Yaw Override
- **Idea:** When spawning a prop (or swapping desks) compute a yaw using the active desk’s layout frame or, if unavailable, the current camera yaw. Apply this yaw before the prop ever renders.
- **Implementation:** Added a helper that looked at the layout frame’s `forward` vector or subtracted 90° from the camera yaw, then replaced the catalog/default rotation with the computed yaw.
- **Result:** No visible change in prop orientation. Desks ended up rotating unexpectedly, which in turn perturbed the layout frame and camera alignment.
- **Root Cause:** Most models already bake their intended forward vector into the GLB transforms. Overwriting yaw with a camera-derived value just re-applied the same angle—or in the desk case, drifted it. There was no direct knowledge of each model’s actual “front”, so the override wasn’t meaningful.

## Attempt 2 – Geometry-Derived Forward Vector
- **Idea:** Let each prop auto-report a facing direction by analyzing its triangles in world space:
  - Traverse every mesh.
  - For each triangle, compute the normal, project onto the XZ plane, weight by triangle area, and accumulate.
  - Spawn-time logic would compare this “forward” to the camera yaw and rotate the prop once to match.
- **Implementation:** Introduced a temporary `alignMode` flag in `genericPropsStore`, hooked the new scan into `GLTFProp`, and rotated inside `GenericProp` after the model loaded.
- **Result:** Some props rotated more severely (incorrect orientation) and others still came in sideways.
- **Root Causes:**
  - Symmetric geometry (circular tables, cylinders, etc.) yields normals that cancel out or point in arbitrary directions.
  - Many models have decorative details (vents, supports) that dominate surface area and pull the accumulated normal away from the intended “front”.
  - Because the rotation happened after load, async timing caused flicker and briefly misaligned the camera/desk again.

## Lessons & Next Steps
- Prop models need explicit orientation metadata. Geometry heuristics alone cannot reliably infer artist intent.
- Potential avenues:
  1. **Model Metadata:** During analysis, surface candidate forward vectors (e.g., from large planar surfaces) and allow a manual “front” override per prop in `prop-overrides.json`.
  2. **Catalog Hints:** Extend catalog entries with an optional `defaultYawOffset` or `forwardNode` so we only adjust props known to need correction.
  3. **Interactive Calibration:** Add a one-time calibration UI to rotate props in staging, storing the yaw delta back in the catalog.

For now we reverted the code to the prior baseline so the camera and desk behavior stay consistent. Let me know which follow-up direction you'd like to explore. 
