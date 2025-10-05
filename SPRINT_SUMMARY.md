# Sprint Summary: Generic Props Migration & UX Refinements

**Date:** January 2025
**Status:** In Progress (Phases 4, 5, 7 remaining)

---

## Table of Contents
1. [Overview](#overview)
2. [Completed Work](#completed-work)
3. [Remaining Work](#remaining-work)
4. [Key Architectural Changes](#key-architectural-changes)
5. [Bug Fixes](#bug-fixes)
6. [UX Improvements](#ux-improvements)

---

## Overview

This sprint focused on migrating the legacy hardcoded desk/monitor system to a unified **Generic Props** architecture, where all props (desk, monitor, lamp, etc.) are spawned from a catalog and use the same state management system. This enables:

- **Dynamic surfaces:** Props can register multiple surfaces with different kinds
- **Docking system:** Props can dock to desk with relative offsets maintained through rotation
- **Unified controls:** Same UI pattern for all props (scale, rotate, dock)
- **Frozen world:** Scene remains functional even without a desk (props become inactive)

---

## Completed Work

### ✅ Sprint 1: Generic Props Foundation
**Goal:** Create infrastructure for spawnable props beyond desk/monitor

**Changes:**
- Created `PROP_CATALOG` (`apps/web/src/data/propCatalog.ts`) with prop definitions
- Created `genericPropsStore.ts` for managing spawned props (position, rotation, scale, status, docking)
- Created `GenericProp.tsx` component with auto-height adjustment and dragging
- Created `GenericPropControls.tsx` for spawning props from catalog
- Created `PropScaleControls.tsx` for scaling selected props
- Created `LayoutControls.tsx` for rotation and docking

**Key Features:**
- Props spawn at desk height automatically (using `DESK_CLEARANCE = 0.015m`)
- Props can be selected (teal ring highlight)
- Props can be scaled (0.6x - 1.6x)
- Props can be rotated (5° increments)
- Props can be docked to desk (position/rotation locked to desk frame)

---

### ✅ Sprint 2 (Partial): Desk Migration to Generic Props
**Goal:** Move desk from hardcoded system to generic props catalog

**Phases Completed:**

#### Phase 1: Add Desk to Catalog
- Added `desk-default` entry to `PROP_CATALOG`
- Configured surface registration: `desk-surface` with kind `'desk'`
- Set anchor: `{ type: 'bbox', align: { x: 'center', y: 'max', z: 'center' } }`

#### Phase 2: Update Desk Lookups
**Changed from:** Hardcoded `useSurface('desk')`
**Changed to:** Dynamic `useSurfacesByKind('desk')`

**Files updated:**
- `useAutoLayout.ts` - Query desk by kind for layout frame
- `GenericProp.tsx` - Query desk by kind for height adjustment
- `useLayoutValidation.ts` - Query desk by kind for validation
- `debugHud.tsx` - Query desk by kind for debug info
- `useDockConstraints.ts` - Query desk by kind for docking

**New hook created:** `useSurfacesByKind(kind)` with memoized snapshots to prevent infinite re-renders

#### Phase 3: Frozen World Implementation
**Features:**
- Auto-spawn desk on scene mount (uses `hasSpawnedDeskRef` to prevent duplicates)
- Auto-undock all props when desk is deleted
- "No Workspace Active" banner when no desk exists
- Props become inactive when no desk (can't drag, no layout frame)

#### Phase 6: Remove DeskProp Component
- Removed old `<DeskProp>` rendering from `SceneRoot.tsx`
- Desk now spawns via `spawnGenericProp()` and renders via `<GenericPropsLayer>`

---

### ✅ Code Review & Critical Bug Fixes

#### Bug 1: Desk Rotation Controls Not Working
**Problem:** Clicking "Rotate Left/Right" buttons didn't rotate desk when deselected
**Root Cause:** `LayoutControls` was using old `layoutOverridesStore.deskYawDeg` but desk now uses `genericPropsStore.rotation`

**Fix:**
- `LayoutControls.tsx` now finds desk prop and rotates it via `rotateGenericProp()`
- `useDockConstraints.ts` now reads desk rotation from `deskProp.rotation[1]` instead of overrides
- Removed `rotateDesk()` calls, everything uses `rotateGenericProp()` now

#### Bug 2: Desk Height "Ballooning" Above Props
**Problem:** Desk adjusted its own height when spawning monitor
**Root Cause:** Height adjustment effect in `GenericProp.tsx` applied to ALL props including desk

**Fix:**
- Added early return: `if (prop.catalogId === 'desk-default') return;`
- Desk no longer adjusts to sit on its own surface

#### Bug 3: Props Spawning Below Desk
**Problem:** Props spawned at `y=0.05` then "bloomed up" to desk on first move
**Root Cause:** `STAGING_POSITION` had hardcoded y-value, height adjustment only triggered on interaction

**Fix:**
- `GenericPropControls.tsx` now calculates spawn position based on desk surface: `[0.6, deskHeight + DESK_CLEARANCE, -0.2]`
- Props appear at correct height immediately

#### Bug 4: Height Adjustment Not Re-running on Desk Scale
**Problem:** Props wouldn't re-adjust height when desk was scaled
**Root Cause:** `hasAdjustedHeightRef` prevented re-running after first adjustment

**Fix:**
- Added `prevDeskHeightRef` to track desk height changes
- Reset `hasAdjustedHeightRef.current = false` when `deskHeight` changes significantly

#### Bug 5: Unused Variables
**Cleanup:**
- Removed unused `deskSurface` variables from `SceneRoot.tsx` and `useDockConstraints.ts`
- Removed unused `useLayoutOverridesState` import from `useDockConstraints.ts`

#### Bug 6: Type Safety on SurfaceId
**Problem:** `SurfaceId` changed from strict union to loose `string`, losing autocomplete/safety
**Fix:**
- Implemented branded type: `string & { readonly __brand: 'SurfaceId' }`
- Created `createSurfaceId(id: string): SurfaceId` helper
- Updated all hardcoded surface IDs to use `createSurfaceId()`
- Updated hooks to accept `SurfaceId | ''` for optional fallback

---

### ✅ UX Refinements Sprint

#### Refinement 1: Auto-Show/Hide Edit Panels
**Goal:** Remove manual toggle buttons, make panels appear automatically on selection

**Changes:**
- **PropScaleControls.tsx:**
  - Removed "Scale: {label}" toggle button
  - Removed `isOpen` state
  - Panel shows when `genericTarget !== null` (any prop selected)
  - Panel hidden when nothing selected

- **LayoutControls.tsx:**
  - Removed "Show Layout / Hide Layout" toggle button
  - Removed `isOpen` state
  - Panel shows when `rotationTarget !== null` (any prop selected)
  - Panel hidden when nothing selected

- **GenericPropControls.tsx:**
  - Kept "Add Prop" button (not tied to selection)

**Result:** Click prop → panels appear. Click away → panels disappear. No confusing toggle states.

#### Refinement 2: Disable Editing When Docked
**Goal:** Prevent editing docked props, show clear visual feedback

**Changes:**
- **Rotation controls:**
  - Greyed out buttons (40% opacity, `cursor-not-allowed`)
  - Empty callbacks when docked (no-op)
  - Added teal "Undock to edit" hint next to "(Docked)"

- **Scale controls:**
  - Disabled slider (`disabled={isDocked}`)
  - Greyed out slider and reset button (40% opacity)
  - No-op onChange when docked

**Result:** Docked props cannot be edited, clear visual feedback, helpful hint text.

#### Refinement 3: Desk-Specific Button Text
**Goal:** "Lock Desk" instead of "Dock to Desk" when desk is selected

**Changes:**
- `LayoutControls.tsx` detects `isDesk = selectedGeneric?.catalogId === 'desk-default'`
- Button text:
  - Desk: "Lock Desk" / "Unlock Desk"
  - Other props: "Dock to Desk" / "Undock from Desk"

**Result:** More intuitive language for desk locking.

#### Refinement 4: Remove Window Chrome
**Goal:** Fullscreen scene without title/subtitle

**Changes:**
- `apps/web/src/app/page.tsx`:
  - Removed `<h1>Sticky Notes 3D — MVP Boot</h1>`
  - Removed `<p>If you can see a lit 3D cube below...</p>`
  - Removed padding from `<main>`

**Result:** Clean fullscreen 3D view, no scrolling needed.

#### Refinement 5: Remove "Editing Scale" Banner
**Goal:** Allow immediate dragging after spawn, no blocking banner

**Changes:**
- Changed spawn status from `'editing'` to `'dragging'` in `genericPropsStore.ts`
- Removed `<GenericPropScaleBanner>` from `SceneRoot.tsx`
- Deleted import of `GenericPropScaleBanner`

**Result:** Props can be dragged immediately after spawning, no "press Done to finish" banner.

---

## Remaining Work

### ❌ Phase 4: Migrate Desk Rotation to genericPropsStore
**Status:** Actually COMPLETED during bug fixes! ✅

The desk rotation is now fully using `genericPropsStore.rotation`. The `layoutOverridesStore.deskYawDeg` is no longer used for desk rotation.

**Cleanup needed:**
- Could remove `deskYawDeg` from `layoutOverridesStore` (but it's not causing issues)

---

### ❌ Phase 5: Migrate Desk Scaling, Delete propScaleStore
**Status:** INCOMPLETE - desk still uses old scaling system

**Current state:**
- Desk uses `propScaleStore` for scaling (separate from generic props)
- Other generic props use `genericPropsStore.scale`

**What needs to happen:**
1. Update `PropScaleControls.tsx` to handle desk from `genericPropsStore`
2. Remove fallback to `propScaleStore`
3. Test desk scaling works correctly
4. Delete `propScaleStore.ts` and `usePropScale.ts`
5. Remove any remaining imports

**Risk:** Desk scaling logic might have special requirements (check `useAutoLayout.ts` for `scaledBounds` calculations)

---

### ❌ Phase 7: Clean Up PropId Type
**Status:** INCOMPLETE - type cleanup needed

**Current state:**
- `PropId` type in `propBoundsStore.ts` still includes `'desk'`
- Now that desk is in `genericPropsStore`, this is redundant

**What needs to happen:**
1. Update `PropId` type to remove `'desk'` from union
2. Update `propBoundsStore` to only handle monitor bounds
3. Consider renaming to `MonitorBoundsStore` for clarity
4. Update any remaining references

---

## Key Architectural Changes

### Surface System Evolution

**Before:**
```typescript
// Hardcoded surface IDs
const deskSurface = useSurface('desk');
const monitorSurface = useSurface('monitor1');
```

**After:**
```typescript
// Dynamic surface kinds
const deskSurfaces = useSurfacesByKind('desk');
const deskSurfaceId = deskSurfaces[0]?.id;
const deskSurface = useSurface(deskSurfaceId ?? '');
```

**Why:** Allows multiple props to register surfaces with the same kind (e.g., multiple monitors all with kind='screen')

---

### Prop State Management Evolution

**Before:**
- Desk: Hardcoded in SceneRoot, rotation in `layoutOverridesStore`, scale in `propScaleStore`
- Monitor: Hardcoded in SceneRoot, auto-positioned by `useAutoLayout`
- Props: Separate `genericPropsStore` for spawned props

**After:**
- **All props** (desk, monitor, lamp): In `genericPropsStore` with unified state
- Position, rotation, scale, status, docking all in one place
- Auto-spawn desk on mount, delete removes desk
- Desk can be docked (locked in place)

---

### Docking System

**Key concept:** Docked props maintain position/rotation relative to desk's layout frame

**Implementation:**
- `dockPropWithOffset()` calculates offset from desk center in desk-local coordinates (lateral, depth, lift, yaw)
- `useDockConstraints()` watches desk frame changes and updates docked props
- Docked props cannot be dragged (greyed out controls)
- Docking survives desk rotation/scaling

**Math:**
```typescript
// Dock offset calculation
const lateral = relativePos.dot(desk.right);   // left/right
const depth = relativePos.dot(desk.forward);    // front/back
const lift = relativePos.dot(desk.up);          // vertical
const yaw = propYaw - deskYaw;                  // relative rotation

// Reconstruction
const position = deskCenter + lateral*right + depth*forward + lift*up;
const rotation = [0, yaw + deskYaw, 0];
```

---

### Frozen World Concept

**Definition:** Scene state when no desk exists

**Behavior:**
- Props remain visible but inactive (can't drag)
- No layout frame (layoutFrame.frame = null)
- "No Workspace Active" banner with "Add Desk" button
- Auto-undock all props when desk deleted

**Implementation:**
- `hasDesk = !!layoutState.frame` (desk existence check)
- `canDrag = isActive && !!deskSurface && !prop.docked` (drag check)
- Auto-undock effect in `SceneRoot.tsx` watches for desk deletion

---

## Bug Fixes

### Critical Fixes
1. ✅ Desk rotation controls work when deselected
2. ✅ Desk doesn't self-adjust height
3. ✅ Props spawn at correct height immediately
4. ✅ Props re-adjust height when desk scaled
5. ✅ Surface lookups don't cause infinite re-renders
6. ✅ Type safety with branded SurfaceId type

### UX Fixes
1. ✅ Panels auto-show/hide on selection
2. ✅ Docked props can't be edited (greyed out)
3. ✅ Clear "Undock to edit" hint
4. ✅ Desk-specific "Lock/Unlock" button text
5. ✅ Props draggable immediately after spawn (no "Done" banner)

---

## File Change Summary

### New Files
- `apps/web/src/data/propCatalog.ts` - Prop definitions with surfaces
- `apps/web/src/state/genericPropsStore.ts` - Unified prop state management
- `apps/web/src/state/selectionStore.ts` - Selection tracking
- `apps/web/src/canvas/GenericProp.tsx` - Generic prop rendering
- `apps/web/src/canvas/GenericPropsLayer.tsx` - Layer for all generic props
- `apps/web/src/canvas/GenericPropControls.tsx` - Spawn props UI
- `apps/web/src/canvas/hooks/useGenericProps.ts` - Generic props hooks
- `apps/web/src/canvas/hooks/useSelection.ts` - Selection hook
- `apps/web/src/canvas/hooks/useSurfacesByKind.ts` - Dynamic surface lookup
- `apps/web/src/canvas/hooks/useDockConstraints.ts` - Docking system

### Modified Files
- `apps/web/src/app/canvas/SceneRoot.tsx` - Added generic props layer, removed DeskProp, frozen world banner
- `apps/web/src/app/page.tsx` - Removed title/subtitle chrome
- `apps/web/src/canvas/surfaces.ts` - Branded SurfaceId type
- `apps/web/src/canvas/LayoutControls.tsx` - Auto-show/hide, desk rotation fix, docking UI
- `apps/web/src/canvas/PropScaleControls.tsx` - Auto-show/hide, disable when docked
- `apps/web/src/canvas/hooks/useAutoLayout.ts` - Query desk by kind
- `apps/web/src/canvas/hooks/useLayoutValidation.ts` - Query desk by kind
- `apps/web/src/canvas/debugHud.tsx` - Query desk by kind

### Deleted Components
- `GenericPropScaleBanner.tsx` - Removed blocking "Editing Scale" banner

---

## Current Project State

### Working Features
✅ Spawn props from catalog (desk, monitor, lamp)
✅ Select props (teal ring highlight)
✅ Scale props (0.6x - 1.6x slider)
✅ Rotate props (5° increment buttons)
✅ Drag props on desk surface
✅ Dock props to desk (position/rotation locked)
✅ Desk rotation with docked props following
✅ Auto-height adjustment to desk surface
✅ Frozen world (no desk = inactive scene)
✅ Auto-show/hide edit panels
✅ Disable editing when docked

### Known Issues
⚠️ Desk scaling still uses old `propScaleStore` (Phase 5 incomplete)
⚠️ `PropId` type still includes 'desk' (Phase 7 incomplete)

### Next Steps
1. Complete Phase 5 (migrate desk scaling)
2. Complete Phase 7 (clean up PropId type)
3. Test comprehensive workflow: spawn → drag → scale → rotate → dock → delete desk → add desk
4. Consider migrating monitor to generic props (currently hardcoded in catalog)

---

## Testing Checklist

### Manual Testing Required
- [ ] Spawn desk → appears at 0,0,0
- [ ] Spawn monitor → appears at desk height
- [ ] Spawn lamp → appears at desk height
- [ ] Select prop → scale/layout panels appear
- [ ] Deselect prop → panels disappear
- [ ] Scale prop → size changes smoothly
- [ ] Rotate prop → rotates in 5° steps
- [ ] Drag prop → moves on desk surface
- [ ] Dock prop → locks to desk
- [ ] Rotate desk with docked prop → prop follows
- [ ] Try editing docked prop → controls greyed out
- [ ] Undock prop → controls enabled
- [ ] Delete desk → "No Workspace" banner appears
- [ ] Add desk → scene activates
- [ ] Scale desk → props re-adjust height

---

## Context for Next Session

**You are working on:** Sticky3D, a 3D workspace visualization built with Next.js 15 + React Three Fiber

**Current sprint:** Generic Props Migration (Phases 4, 5, 7 remaining)

**What just happened:**
- Successfully migrated desk to generic props system
- Fixed critical bugs (rotation, height adjustment, infinite loops)
- Refined UX (auto-show panels, disable docked controls, remove banner)

**What's next:**
- Phase 5: Migrate desk scaling from `propScaleStore` to `genericPropsStore`
- Phase 7: Clean up `PropId` type (remove 'desk')
- Consider: Migrate monitor to generic props catalog

**Important files to understand:**
- `apps/web/src/data/propCatalog.ts` - Prop definitions
- `apps/web/src/state/genericPropsStore.ts` - Prop state management
- `apps/web/src/canvas/GenericProp.tsx` - Prop rendering with height adjustment
- `apps/web/src/canvas/hooks/useDockConstraints.ts` - Docking system
- `apps/web/src/canvas/hooks/useAutoLayout.ts` - Layout frame calculation (500+ lines!)

**Key concepts:**
- **Layout Frame:** Desk surface defines canonical coordinate frame (up/right/forward)
- **Docking:** Props store offset from desk center in desk-local coordinates
- **Frozen World:** Scene without desk = inactive props, show banner
- **Surface Kinds:** Query surfaces by kind (e.g., 'desk', 'screen') not hardcoded IDs

**Git tip:** Current branch is `reworking-props`, latest commit migrates desk to generic props system
