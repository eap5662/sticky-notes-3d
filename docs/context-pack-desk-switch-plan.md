# Desk-Switch Normalized UV Plan – Context Pack (February 2026)

This is a handoff summary for implementing the desk-switch improvements that reuse the “hidden mirror” workaround introduced for docking.

---

## 1. Core Idea

Use the polygon normalization helpers (`surfaceFrame.ts`) to:

1. Project every prop on the *old* desk into normalized UV space.
2. Clamp / map those normalized values to the *new* desk’s polygon.
3. Reconstruct world positions by unprojecting and reapplying lift along the new desk normal.

This keeps props inside the visualized red bounds, avoids the reflected “mirror” (see references below), and preserves relative arrangement.

---

## 2. Key Helpers & Files

### `apps/web/src/canvas/math/surfaceFrame.ts`
- `getSurfaceShapeInfo(meta)`: returns `projectedURange`, `projectedVRange`, and the normalized polygon (same data the overlay uses).
- `normalizedUVToProjected(meta, u, v)` / `mapProjectedToNormalized`: convert between normalized UVs and surface-space meters.
- `isUVInsideSurface(meta, u, v)`: already returns false for the mirrored half (hard guard).
- `clampUVToShape(meta, u, v)`: works in normalized space now; use to pull UVs onto the polygon boundary.
- `projectPointToSurface` / `unprojectFromSurface`: lift-aware projection in both directions.

### `apps/web/src/canvas/DeskSurfaceBoundsMarkers.tsx`
Uses the same normalized data to render the red outline/fill. If the visual overlay ever diverges, the mapping code is probably out of sync.

### Docking UI guardrail (reference behaviour)
- `apps/web/src/canvas/props/GenericProp.tsx` (around `isOverDesk`): polygon + outside => `false`.
- `apps/web/src/canvas/LayoutControls.tsx` (`isOverDesk` logic & `handleDock`): same guard, so the Dock button is disabled when props sit in the mirror.
- `apps/web/src/canvas/hooks/useDockConstraints.ts`: clamps normalized UVs before unprojecting stored attachments.
- `apps/web/src/state/deskSwapStore.ts`: existing swap logic; the plan will extend/rewrite parts of this file.
- `apps/web/src/canvas/math/canonicalCoordinates.ts`: canonical encode/decode now works via normalized UVs; reuse the pattern when updating desk swap snapshots.

### Documentation
- `docs/desk-surface-hidden-mirror.md`: describes the mirror bug and workaround.
- `CLAUDE.md` (new warning section) reiterates the guardrail for future agents.

---

## 3. Implementation Plan (Desk Switch)

1. **Precompute shape info** for both old and new desks (`getSurfaceShapeInfo`).
2. **Normalize old positions**: `projectPointToSurface` → `mapProjectedToNormalized`. Record `oldNormUV` + `oldLift`.
3. **Normalize attachments & snapshots**: run the same conversion for any saved `offsetUV` or canonical data.
4. **Map to new desk**:
   - `projected = normalizedUVToProjected(newMeta, normU, normV)`
   - `inside = isUVInsideSurface(newMeta, projected.u, projected.v)`
   - If outside, `clamped = clampUVToShape(...)`, then recompute `projected`.
5. **Rebuild world position**:
   - `base = unprojectFromSurface(newMeta, projected.u, projected.v, 0)`
   - `target = base + newNormal * oldLift`
   - Validate: reproject, ensure `lift` ≈ `oldLift` (raise to epsilon if necessary).
6. **Resave attachments** with normalized UVs so future swaps start clean.
7. **Optional overlap resolution** if props collide on the new desk.
8. **Ghost preview** (if applicable): reuse the same normalized mapping so the preview matches final placement.
9. **Testing**: swap polygon↔polygon, rect↔polygon, and older attachments. Verify props stay on the red overlay and at the correct height.

---

## 4. Integration Points

- **Desk swap store** (`deskSwapStore.ts`):
  - Entry point for swapping desks; the mapping logic belongs here.
  - Ensure we update both the actual placement and the `DockAttachment` data.
  - Add validation passes (lift check, clamp) inside the swap pipeline.

- **Ghost preview / swap analysis** (`DeskSwapPreviewLayer.tsx` or related files):
  - If the preview shows prop positions, reuse the normalized mapping before rendering hints.

- **Height validation**:
  - The new normal may differ; always reproject after applying lift to confirm we sit just above the surface.
  - For angled desks, use the desk’s normal vector instead of assuming +Y.

- **Docs**:
  - Update any references to “desk swap remapping” once the new workflow ships.

---

## 5. Risks / Edge Cases

- Props saved before this change might have out-of-range UVs. Clamp them the first time we see them.
- Extremely small surfaces: ensure `max(span, 1e-6)` remains consistent with docking (already handled).
- Overlapping props: the mapping preserves relative UVs but doesn’t prevent collisions; handle separately if the UX requires it.

---

## 6. Next Steps

1. Modify desk swap to follow the normalized UV workflow above.
2. Update the swap preview/UI to use the same data so it reflects final prop positions.
3. Retire any legacy “rectangular fallback” inside the swap logic (polygon desks must respect the normalized polygon).
4. Keep the docking guardrail intact; the swap code should piggyback on those helpers rather than re-implementing them.

With this context, a new agent can dive straight into desk-switch implementation while avoiding the hidden mirror and preserving prop layout.***

---

## 7. Current Gaps / Known Issues (January 2027)

- **Initial swap height drift (Grey / Tan desks).** Swapping from the default L-desk to the *Grey Computer Desk* or *Tan Desk* still positions props several centimetres above/below the surface. Subsequent swaps behave, which suggests the remap runs before the new desk’s surface metadata is registered. A post-swap reconcile hook (or a completion gate that waits for metadata) is still required.
- **No UX guard while surfaces load.** Because the swap completes immediately, users never see a “surfaces still loading” message; we silently reuse stale lift/UV data. A future fix should either block completion until metas exist or automatically reproject once they appear.
- **Undo mirrors the inaccurate placement.** Undo faithfully restores the coordinates produced by the first swap—so it currently preserves the incorrect height. Once the height bug is resolved, double-check that snapshots are refreshed after the post-load reconcile.
- **Force path references.** The store exposes an optional `{ force: true }` escape hatch (used by hotkeys) but the UI does not present a “Force” button. When documenting or guarding the flow, refer to the actual controls (“Complete”, “Cancel”) to avoid confusion.
