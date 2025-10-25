# Desk Attachment Refactor Plan

This document captures the implementation strategy for transitioning the desk
system to the new attachment model described in the recent design discussion.
It is meant to keep the work cohesive across multiple PRs/sprints.

## High‑Level Goals

- Represent desk attachments with per-surface semantics so props survive desk
  swaps and deletions without orphaning.
- Prepare the runtime for eventual multi-desk support while keeping the near
  term behaviour compatible with a single active desk.
- Provide a transactional “Swap Desk” experience that preserves docking intent.

## Planned Work Phases

### Sprint 1 – Data & Surface Foundations

- **DockAttachment schema**
  - Add `DockAttachment` and optional `SurfaceSnapshot` types to
    `genericPropsStore`.
  - Extend undo history snapshots to capture the richer attachment payload.
  - Gate existing `dockOffset` usage and maintain backwards compatibility while
    props get migrated in-memory.
- **Surface metadata**
  - Update GLTF surface registration to mint per-instance surface ids
    (`deskInstanceId/surfaceId`).
  - Store orthonormal plane frame plus a `shape`
    (`rect` initially, polygon planned).
  - Expose helpers (`project`, `unproject`, `clampUv`) through a new
    surface adapter util.

### Sprint 2 – Lifecycle States & Safe Deletion

- Introduce `DockState` for `attached`, `floating`, `pendingReattach`.
- Replace the hard desk delete guard with a flow that offers “Float docked
  props” and keeps attachments for future reattachment.
- Auto-reattach props when a compatible desk appears (single-surface MVP).
- Update UI toast/badge feedback and ensure undo/redo transitions between states.

### Sprint 3 – Swap Desk Flow (MVP)

- Desk picker + ghost preview that supports rectangular desks.
- Transactionally swap the desk and update attachments in one undoable action.
- Fallback to `floating` for unsupported mappings and surface a summary toast.

### Sprint 4 – Advanced Mapping & Review UX

- Polygon OBB mapping and custom bounds carry-over.
- Conflict review panel with per-item overrides and clamp warnings.
- Optional slot semantics for desks exposing named regions.

## Key Technical Notes

- **Multi-desk readiness**: Code paths should index surfaces by
  `{deskId, surfaceId}` instead of assuming `useSurfacesByKind('desk')[0]`.
- **UV conventions**: Rectangular surfaces will map UV into `[0,1]^2`
  (upper-left origin). Polygon support will normalise coordinates using each
  surface’s cached OBB.
- **Migration**: No persistent format exists, so we can migrate in-memory on
  load by translating legacy `dockOffset` props into `DockAttachment` once the
  new helpers land.
- **Snapshots**: `SurfaceSnapshot` should be a light-weight struct carrying
  shape info + OBB parameters (avoid storing full meshes).

## Immediate Next Steps

1. Land the `DockAttachment` scaffolding and surface metadata extensions.
2. Update `useDockConstraints` to read from the new attachment model once the
   helpers exist.
3. Audit all `desk-default` checks and prepare to replace them with
   instance-aware queries as the data model scales.

---

## Progress Snapshot (Sprint Log)

> Last updated: _see git history for precise timestamp_

### What’s Shipped

- **Attachment data model**
  - `apps/web/src/state/genericPropsStore.ts` now stores `DockAttachment`, `DockState`, and light-weight `SurfaceSnapshot` metadata per prop.
  - Undo snapshots (`apps/web/src/state/undoHistoryStore.ts`) capture the richer attachment state via the new `createSnapshotFromProp` helper.

- **Surface metadata & geometry**
  - Each prop instance registers per-instance surface IDs (`propId:surfaceId`) in `apps/web/src/canvas/props/GenericProp.tsx`, writing owner/surface vectors + rectangular shape data to `surfaceMetaStore`.
  - `apps/web/src/canvas/props/propSurfaces.tsx` mirrors that behaviour for hook-based registrations.
  - `apps/web/src/state/surfaceMetaStore.ts` now tracks plane basis vectors, shapes, and owner ids; equality logic keeps store subscriptions stable.
  - Introduced `apps/web/src/canvas/math/surfaceFrame.ts` with `projectPointToSurface`, `unprojectFromSurface`, and `clampUVToShape` helpers (rectangular MVP).

- **Docking logic migration**
  - `apps/web/src/canvas/LayoutControls.tsx` records both legacy offsets and the new UV-based `DockAttachment` (using the projection helpers, falling back to frame extents).
  - `apps/web/src/canvas/hooks/useDockConstraints.ts` prefers attachments when recomputing positions, ignores desk-id mismatches, and still falls back to offsets for legacy props.
  - Scene lifecycle (`apps/web/src/app/canvas/SceneRoot.tsx`) floats props when a desk disappears and reattaches any with matching desk instance ids when a new desk spawns.

- **Swap Desk MVP**
  - Added `apps/web/src/state/deskSwapStore.ts` to coordinate desk replacement: it spawns the new desk, _attempts_ to remap attachments/offsets (current heuristic frequently misplaces props; expect manual fixes), deletes the old desk, selects the replacement, and records a `desk-swap` undo action.
  - Existing undo system (`apps/web/src/canvas/hooks/useUndoHistory.ts`) learned how to undo that transaction, restoring the former desk and each prop’s prior attachment.
  - UI hooks:
    - Layout controls expose a “Replace Desk” affordance (`apps/web/src/canvas/LayoutControls.tsx`). When active, it surfaces guidance and lets the user cancel swap mode.
    - The existing prop catalog panel doubles as a desk picker. When swap mode is active, `apps/web/src/canvas/GenericPropControls.tsx` automatically opens the catalog, locks filters to desks, shows a swap banner, and routes item selection through `completeDeskSwap`.
  - Preview mode renders the candidate desk as a translucent ghost, overlays attachment status rings, and recomputes the mapping during `completeDeskSwap`; failed remaps now block the transaction until reviewed.
  - A persistent “Review Remap” panel summarizes clamped/failed attachments and supports a guarded “Force Swap Anyway” path.

- **Desk detection clean-up**
  - Added `useDeskProp.ts` to resolve the live desk via surface ownership and updated SceneRoot/GenericProp/LayoutControls to rely on the instance id rather than `catalogId === 'desk-default'` shortcuts.
  - Swap mode greys out the currently active desk inside the catalog, preventing self-selection loops, and desk-only controls (lock/delete/bounds) now track whichever desk surface is present (e.g., the corner desk asset).

### In-flight / Outstanding

| Area | Status | Notes |
|------|--------|-------|
| **Desk swap preview UX** | ⚠️ Partial | Ghost rendering + status rings exist, but feedback vanishes once the desk is deselected and mapping output is unreliable (props can shift height/position). Needs persistent messaging and solver overhaul. |
| **Desk delete UX (“Float N props?”)** | ❌ Not started | Still relies on implicit behaviour (props go `floating`). Need confirmation dialog + messaging. |
| **Attachment projection for drag/constraints** | ⚠️ Partial | `useDockConstraints` and docking use new UV helpers, but drag snapping (`GenericProp.tsx`) still uses plane projections without meta-based clamp. Swap remap heuristic routinely misplaces props (under/above desk); solver needs redesign. |
| **Polygon/custom bounds UV mapping** | ❌ Not implemented | `surfaceFrame` only understands rectangles; polygon OBB mapping & custom desk-bound carry-over remain open. |
| **Legacy `dockOffset` removal** | ⚠️ Pending | Kept for fallback/undo paths. Once attachments cover all props (including migration), we can drop the extra field. |
| **Swap undo polish** | ⚠️ Review | Undo recomputes desk rotation/scale via spawn + status calls. Verify this keeps transform parity for scaled/rotated desks. |
| **Multi-desk readiness** | ⚠️ Partial | Most code uses `deskInstanceId`, but LayoutControls and other hooks still assume “first desk surface.” Requires further audit before enabling multi-desk scenes. |
| **Testing** | ❌ Missing | No automated tests or stories yet. Need at least regression tests for dock attach/detach and swap undo. |

### Implementation Notes & File Map

- `apps/web/src/state/deskSwapStore.ts`
  - Entry points: `beginDeskSwap`, `completeDeskSwap`, `cancelDeskSwap`.
  - Stores affected props’ pre/post docking state (offset + attachment) as `DeskSwapAttachmentSnapshot` for undo.

- `apps/web/src/canvas/LayoutControls.tsx`
  - Adds swap controls for desk selection.
  - Uses `projectPointToSurface` to derive UV/lift when docking.

- `apps/web/src/canvas/GenericPropControls.tsx`
  - Detects active swap mode, auto-opens catalog filtered to desks, disables category toggles/search, and routes item selection to swap store.

- `apps/web/src/canvas/math/surfaceFrame.ts`
  - Current fallback assumes rectangular surfaces. Polygon support should reuse stored `shape` once populated with an OBB.

- `apps/web/src/canvas/hooks/useUndoHistory.ts`
  - Handles new `desk-swap` action type, including re-spawning deleted desk and remapping attachments back to the old desk id.

- `apps/web/src/state/genericPropsStore.ts`
  - `floatDockedProp`, `dockPropWithAttachment`, and clone helpers ensure immutability.
  - Still accepts both `DockOffset` + `DockAttachment` for transitional compatibility.

## Roadmap: Remaining Work

1. **Swap UX polish**
   - Surface per-prop actions in the review panel (e.g., float item, pick alternate surface) instead of forcing an all-or-nothing decision.
   - Improve clamping messaging and preview of adjusted placement before allowing a forced commit.

2. **Deletion guard**
   - Prompt when removing a desk that still has attached props: “Float N items?” with actions (`Float & Delete`, `Cancel`).
   - Surface banner/toast when props enter `floating` state, with CTA to pick a new desk.

3. **Advanced attachment mapping**
   - Capture polygon/OBB data during surface extraction (`surfaceMetaStore` already has shape placeholder).
   - Update `clampUVToShape` and remap logic to respect custom polygons and user-specified desk bounds.
   - Carry user-drawn desk bounds across swaps (transform polygon through OBB mapping).

4. **Surface API completeness**
   - Extend extraction to populate `shape: polygon` for non-rect surfaces.
   - Provide slot/mask metadata when assets expose semantic regions.

5. **Cleanup & migration**
   - Migrate existing props (if any persisted state) from `dockOffset` to `DockAttachment` and eventually remove offsets.
   - Continue auditing remaining `catalogId` guards (non-desk cases) and eliminate `[0]` access of `useSurfacesByKind` ahead of multi-desk scenes.

6. **Testing & Tooling**
   - Add unit/regression tests around `deskSwapStore` and `useDockConstraints`.
   - Consider a Storybook scene or Cypress flow to exercise swap UX and confirm attachments survive desk replacement.

### Open Questions / Decisions Needed

- **Swap preview fidelity**: Should we block apply if clamping/mapping fails, or allow partial success with review UI?
- **Desk inventory scope**: When enabling multiple desks, do we auto-pick an “active” desk or let props attach per instance?
- **Attachment persistence external to app**: If saves/exports appear, we must define a migration path for the new schema.

---

This document captures current state so a future contributor (AI or human) can resume work with minimal ramp-up. Cross-reference the file paths above when continuing implementation. Pending work is grouped under “Remaining Work” and open questions are explicitly listed for decision-making.
