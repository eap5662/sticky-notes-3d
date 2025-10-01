# Prop Auto-Alignment Plan

## Goals
- Keep large props (desk, monitor, future accessories) automatically oriented in a human-friendly layout without manual Blender edits.
- Derive alignment from model metadata (surface normals, bounding boxes, named nodes) so adding new GLTFs stays a data task, not a modeling task.
- Make the alignment pipeline deterministic so validations and previews agree.

## Existing Data We Can Leverage
- Surface metadata (center, normal, u/v directions, thickness) registered via `GLTFProp`.
- World-space prop bounds now stored in `propBoundsStore` for desk and monitor.
- Known canonical vectors: world up (0, 1, 0) and current desk normal.
- Monitor screen plane (surface `monitor1`) already exposes its normal and axes.

## Proposed Workflow
1. **Establish canonical desk axes.**
   - Use desk surface normal for world up validation.
   - Derive forward/right directions from desk prop bounds or from a helper plane node.
   - Persist canonical axes in a new store (e.g., `layoutFrameStore`) so all props share the same frame of reference.
2. **Snap the desk geometry.**
   - Compute the rotation that aligns desk's longest horizontal axis with the canonical "forward" vector.
   - Apply rotation + translation at load time (inside `DeskProp`) so the desk top always sits square in the scene.
   - Expose the resulting transform for downstream consumers (camera defaults, validation, snapping).
3. **Align monitor orientation to the desk.**
   - Rotate monitor around the desk normal so the screen's outward normal matches desk forward.
   - Reuse existing clearance solver (now powered by prop bounds) for vertical placement.
   - Optionally add lateral centering by projecting monitor bounds onto desk axes and moving toward centerlines.
4. **Generalize for future props.**
   - Introduce a declarative `propPlacement` config describing anchor surfaces (e.g., clamp to desk top, align to edge) and fallback heuristics (use bounding-box center, named nodes for sockets).
   - Build utilities for support-point queries (`supportAlongNormal(bounds, axis)`) so all props can request the point that touches a surface along a given direction.
   - Hook validations (penetration, floating) into the same helpers so they stay in sync with placement logic.
5. **Expose authoring/debug tooling.**
   - Extend `DebugHud` to display canonical axes, applied rotations, and active placement rules.
   - Add temporary gizmos for visualizing anchor points while iterating.

## Near-Term Tasks
- [ ] Prototype `layoutFrameStore` that records canonical desk forward/right/up vectors when the desk loads.
- [ ] Port current monitor offset calculation to reuse those vectors (instead of re-deriving per component).
- [ ] Add helper to nudge monitor laterally/rotationally into alignment with the desk frame.
- [ ] Document expected GLTF node names (e.g., `ScreenPlane`, `DeskTopPlane`, optional `ForwardMarker`) to keep new assets consistent.

## Open Questions / Dependencies
- Do future props require per-seat positioning (multiple monitors, speakers) or single-anchor for now?
- Should we support user overrides (manual tweaks saved to settings) once auto-alignment runs?
- Are there GLTF authoring conventions we can rely on (axes orientation, units) that we should codify in validation?
