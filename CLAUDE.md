# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 🚨 RECENT MAJOR CHANGES (January 2025)

**Migration to Generic Props System - IN PROGRESS**

The codebase recently underwent a major refactor migrating from hardcoded desk/monitor props to a unified **Generic Props** system. See `SPRINT_SUMMARY.md` for full details.

**Key Changes:**
- ✅ **Desk is now a generic prop** - Spawns from `PROP_CATALOG`, managed by `genericPropsStore`
- ✅ **Dynamic surface lookups** - Use `useSurfacesByKind('desk')` instead of `useSurface('desk')`
- ✅ **Docking system** - Props can lock to desk with relative offsets maintained through rotation
- ✅ **Frozen world** - Scene functional without desk (props inactive, "No Workspace" banner)
- ✅ **Auto-show/hide panels** - Edit panels appear on selection, disappear on deselection
- ⚠️ **Phase 5 incomplete** - Desk scaling still uses old `propScaleStore` (needs migration)
- ⚠️ **Phase 7 incomplete** - `PropId` type still includes 'desk' (cleanup needed)

**New Files You Should Know:**
- `apps/web/src/data/propCatalog.ts` - Prop catalog with surfaces config
- `apps/web/src/state/genericPropsStore.ts` - Unified prop state (position, rotation, scale, docking)
- `apps/web/src/canvas/GenericProp.tsx` - Generic prop rendering with auto-height adjustment
- `apps/web/src/canvas/hooks/useDockConstraints.ts` - Docking system (props follow desk rotation)
- `apps/web/src/canvas/hooks/useSurfacesByKind.ts` - Dynamic surface lookup by kind

**Updated Architecture:**
- All props (desk, monitor, lamp) use same state management
- Props spawn from catalog, can be selected/scaled/rotated/docked/deleted
- Desk can be deleted → "frozen world" state
- Docked props cannot be edited (greyed out controls)

**Read SPRINT_SUMMARY.md before making changes to prop system!**

---

## Development Commands

**Starting the development servers:**
```bash
# Web app (Next.js + React Three Fiber)
pnpm dev:web

# Backend server (Express)
pnpm dev:server
```

**Building:**
```bash
# Web app
pnpm -C apps/web build

# Server
pnpm -C apps/server build
```

**Running production:**
```bash
# Web app
pnpm -C apps/web start

# Server
pnpm -C apps/server start
```

## Architecture Overview

### Monorepo Structure
- **apps/web**: Next.js 15 frontend with React Three Fiber for 3D rendering
- **apps/server**: Express backend (minimal; primarily health checks)
- **packages/shared**: Shared TypeScript types and utilities
- Path aliases: `@/` → `apps/web/src/`, `@shared/` → `packages/shared/src/`

### Core Systems

#### 1. GLTF Prop System
The codebase uses a **data-driven GLTF loading system** that automatically extracts surfaces and bounds from 3D models.

**Key Components:**
- `GLTFProp.tsx`: Generic component that loads GLTF models and registers surfaces/bounds
- `surfaceAdapter.ts`: Extracts interactive 2D surfaces from named GLTF nodes
- `DeskProp.tsx` / `MonitorProp.tsx`: Thin wrappers around GLTFProp with prop-specific config

**GLTF Model Requirements:**
- Models must contain named plane nodes (e.g., `DeskTopPlane`, `ScreenPlane`)
- Surfaces are extracted by analyzing node geometry, computing U/V axes, normal, and extents
- Props anchor to scene via bbox alignment (desk: center/max/center, monitor: center/min/center)

**How It Works:**
1. `GLTFProp` loads a model and finds nodes by name
2. `extractSurfaceFromNode()` analyzes geometry to determine:
   - U/V axes (two longest dimensions)
   - Normal (shortest dimension, determines thickness)
   - Origin point (depends on `normalSide` option: 'positive', 'negative', 'center')
3. Surface metadata stored in `surfaceMetaStore`, bounds in `propBoundsStore`
4. Anchor system translates/rotates the entire prop hierarchy to position it correctly

#### 2. Layout Frame System (Camera-First Alignment)
The **layout frame** is the single source of truth for all spatial relationships, built from desk surface metadata.

**Flow:**
```
Desk GLTF loads → extractSurfaceFromNode() → buildLayoutFrame()
   ↓
layoutFrameStore: { up, right, forward, center, extents, bounds }
   ↓
useAutoLayout() orchestrates:
   ├─ solveCamera(): Computes optimal yaw/pitch/dolly to frame desk+monitor
   └─ solveMonitor(): Positions monitor relative to desk frame
```

**Key Files:**
- `useAutoLayout.ts`: **500-line orchestrator** that recomputes layout when desk/monitor/scale/overrides change
- `layoutFrameStore.ts`: Stores canonical desk axes and state (status, frame, camera target, monitor placement)
- Derived axes are orthonormalized: `up = desk.normal`, `right = desk.uDir`, `forward = cross(right, up)`

**Monitor Auto-Placement Logic:**
1. **Vertical**: Lift monitor so lowest point clears desk surface by `MONITOR_CLEARANCE` (1.5mm)
2. **Rotation**: Align monitor normal to face desk `forward` vector (yaw rotation around `up`)
3. **Lateral/Depth**: Center monitor on desk, clamped by `EDGE_MARGIN` (12mm)
4. Overrides (`layoutOverridesStore`) allow manual nudges via UI

#### 3. State Management
**Zustand Stores (Client-Side):**
- `cameraSlice.ts`: Camera mode (wide/screen), yaw/pitch/dolly, per-view defaults & clamps
- `surfaceMetaStore.ts`: Surface metadata (center, normal, uDir, vDir, extents)
- `propBoundsStore.ts`: World-space axis-aligned bounding boxes per prop
- `layoutFrameStore.ts`: Canonical desk frame + computed camera/monitor placement
- `layoutOverridesStore.ts`: Manual adjustments (desk rotation, monitor lateral/depth)
- `propScaleStore.ts`: Uniform scale per prop (0.6x–1.6x)

**State Flow:**
```
GLTF loads → surfaceMetaStore + propBoundsStore
    ↓
useAutoLayout() reads meta/bounds → layoutFrameStore
    ↓
SceneRoot reads layoutFrameStore → applies transforms to props
```

#### 4. Camera System
Two views with distinct behavior and clamps:

- **Wide view**: Camera-controls orbits around the layout target (desk + monitor center), yaw ±45°, pitch -12° → 22°, dolly 2.7–4.8m.
- **Screen view**: Focused orbit around the selected monitor surface center, yaw ±18°, pitch ±12°, dolly 1.0–2.2m.

**Controller:**
- `CameraRigController.tsx`: Unified camera-controls rig that configures clamps per view, listens to `cameraSlice`, and animates transitions (`setLookAt`) when switching views.
- Click monitor → enter Screen view (via existing surface detection).
- Press Escape → return to Wide view.

#### 5. Validation System
`useLayoutValidation.ts` runs checks on every layout change:

- **Desk surface origin mismatch**: Warns if GLTF-derived top differs from registered surface origin
- **Monitor penetration**: Errors if monitor base is below desk surface
- **Face alignment**: Errors if monitor normal deviates >5° from desk forward
- **Edge overflow**: Warns if monitor extends past desk bounds (lateral/depth)

Warnings logged to console; extensible via `onReport` callback.

### Important Constraints & Conventions

#### Scaling System (Current Known Issue)
**Status:** Desk scaling works; **monitor scaling is broken** (as of commit `0c48c7a`).

**How Scaling Should Work:**
1. User adjusts scale via `PropScaleControls` → updates `propScaleStore`
2. `GLTFProp` applies scale to inner group hierarchy (preserves anchor point)
3. `useAutoLayout` detects non-unit scale and computes `scaledBounds` from initial bounds
4. Monitor placement uses `scaledBounds` to recalculate vertical lift + centering

**Current Bug:**
- Monitor scaling doesn't preserve foot anchor correctly
- Foot-anchor logic (lines 437-442 in `useAutoLayout.ts`) may be overcomplicated
- Next work planned: "detaching monitor, scaling, reattaching"

#### Surface Extraction Options
When registering surfaces via `GLTFProp`:
- `normalSide: 'positive'` (default): Use top face (desk top)
- `normalSide: 'negative'`: Use bottom face (desk underside)
- `normalSide: 'center'`: Use mid-plane

Example:
```tsx
<DeskProp
  registerSurfaces={[{
    id: 'desk',
    kind: 'desk',
    nodeName: 'DeskTopPlane',
    options: { normalSide: 'positive' }
  }]}
/>
```

#### Adding New Props
To add a new prop (keyboard, lamp, etc.):

1. Create GLTF with named plane node for interactive surface (if applicable)
2. Place model in `apps/web/public/models/`
3. Create wrapper component extending `GLTFProp`:
   ```tsx
   export function KeyboardProp({ url, position, rotation, scale }) {
     return (
       <GLTFProp
         url={url}
         position={position}
         rotation={rotation}
         scale={scale}
         anchor={{ type: 'bbox', align: { x: 'center', y: 'min', z: 'center' } }}
         propId="keyboard1"
         registerSurfaces={[/* if needed */]}
       />
     );
   }
   ```
4. Extend `useAutoLayout()` to compute placement relative to layout frame
5. Add to `PropId` union in `propBoundsStore.ts`

### File Organization Patterns

**State:**
- `apps/web/src/state/` - Zustand stores for global state

**Canvas/3D:**
- `apps/web/src/canvas/props/` - GLTF loading and prop components
- `apps/web/src/canvas/Cameras/` - Camera controllers
- `apps/web/src/canvas/hooks/` - React hooks for surfaces, bounds, layout, validation
- `apps/web/src/canvas/math/` - Vector/plane math utilities

**UI:**
- `apps/web/src/canvas/debugHud.tsx` - Toggleable debug overlay
- `apps/web/src/canvas/LayoutControls.tsx` - Desk rotation + monitor nudge controls
- `apps/web/src/canvas/PropScaleControls.tsx` - Scaling UI

### Key Technical Details

**Vector Math:**
- All vectors stored as `[x, y, z]` tuples (Vec3 type)
- Use `toVec3(tuple)` to convert to THREE.Vector3 for computation
- Use `toTuple(vec)` to convert back for storage

**Transform Hierarchy in GLTFProp:**
```
<group position={position} rotation={rotation}>         ← Prop transform
  <group position={anchorTuple}>                        ← Translate to anchor
    <group scale={scale}>                               ← Apply scale
      <group position={negativeAnchorTuple}>            ← Translate back
        <primitive object={scene} />                    ← GLTF scene
```
This ensures scaling happens around the anchor point.

**Layout Recomputation:**
`useAutoLayout()` runs when any of these change:
- Desk/monitor surface metadata or bounds
- Manual overrides (desk yaw, monitor lateral/depth)
- Prop scale (X, Y, Z components)

Comparisons use small epsilon (1e-4 to 1e-6) to avoid thrashing from floating-point drift.

## Planning Documents

The `docs/` folder contains implementation plans:
- `Plan camera-first desk align.txt`: Detailed 6-step plan for layout system (already implemented)
- `prop-alignment-plan.md`: High-level goals and proposed workflow

These documents describe the implemented architecture and can guide future extensions.
