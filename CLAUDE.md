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

**Prop onboarding (batch processing):**
```bash
# Analyze GLB files in /models folder
pnpm props:analyze

# Generate catalog entries from analysis
pnpm props:generate
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
**⚠️ CRITICAL: Read `docs/camera-system-technical-guide.md` for complete implementation details**

The camera system uses **spherical coordinates** (yaw, pitch, dolly) and maintains alignment with the desk's forward vector through dynamic calculations.

**Two Views:**
- **Wide view**: Desk-aligned camera positioned in front of desk (where user sits), yaw ±45° around 90° (desk-forward aligned), pitch -12° → 50°, dolly 2.7–4.8m
- **Screen view**: Monitor-perpendicular camera with **dynamic yaw clamps** (±30° around calculated screen-facing direction), pitch -30° → 45°, dolly 0.5–3.0m

**Key Mechanisms:**
- **Desk-relative alignment**: Camera yaw calculated from desk's forward vector using quaternion rotation around desk.up axis
- **Dynamic clamps**: Screen view yaw constraints adapt to monitor orientation (centered around `solveScreenCamera()` result)
- **Layout frame system**: Desk surface vectors transformed from local to world space via desk Y-rotation
- **Separate yaw/pitch**: Yaw extracted from horizontal direction only (NOT full 3D direction) to prevent geometric distortion

**Critical Files:**
- `apps/web/src/camera/cameraViews.ts` - View configurations (static clamps, defaults, target resolvers)
- `apps/web/src/canvas/Cameras/CameraRigController.tsx` - Applies clamps, handles transitions, implements dynamic screen clamps
- `apps/web/src/canvas/hooks/useAutoLayout.ts` - Calculates desk frame and camera poses (`solveCamera`, `solveScreenCamera`)

**Usage:**
- Click monitor → enter Screen view (camera animates to screen-perpendicular position)
- Press Escape → return to Wide view (camera returns to desk-aligned position)

**See Technical Guide** for:
- Complete spherical coordinate system explanation
- How desk rotation updates camera alignment
- Dynamic clamp calculation for screen view
- Troubleshooting common camera issues
- Data flow diagrams

#### 5. Validation System
`useLayoutValidation.ts` runs checks on every layout change:

- **Desk surface origin mismatch**: Warns if GLTF-derived top differs from registered surface origin
- **Monitor penetration**: Errors if monitor base is below desk surface
- **Face alignment**: Errors if monitor normal deviates >5° from desk forward
- **Edge overflow**: Warns if monitor extends past desk bounds (lateral/depth)

Warnings logged to console; extensible via `onReport` callback.

### Important Constraints & Conventions

#### Scaling System
**Default Scale:**
- Props can specify `defaultScale` in catalog (e.g., `defaultScale: 2` for 2x size)
- Applied at spawn time in `GenericPropControls.tsx`
- User can further adjust with scale controls (0x–100x via numeric input)

**How Scaling Works:**
1. User adjusts scale via `PropScaleControls` → updates `genericPropsStore`
2. `GLTFProp` applies scale to inner group hierarchy (preserves anchor point)
3. Scale stored as `Vec3` in prop state (uniform scaling: `[s, s, s]`)
4. Scale controls use numeric input (not slider) for precision

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

#### Adding New Props (Automated Batch System)

**Recommended Workflow:**
1. **Prepare models**: Download GLB files (e.g., from poly.pizza), place in `apps/web/public/models/`
2. **Optional - Add surfaces**: For props needing interactive surfaces (monitors, whiteboards), open in Blender and add named plane nodes:
   - Screens: `ScreenPlane`, `ScreenSurface`, `MonitorSurfacePlane`
   - Whiteboards: `WhiteBoardSurface`, `BoardSurface`
   - Desks: `DeskTopPlane`, `DeskSurface`
   - Must be actual mesh geometry (not Empty nodes), duplicate surface faces and parent to prop object
3. **Configure surfaces**: Add entries to `prop-overrides.json` for props with surfaces:
   ```json
   {
     "Monitor-large.glb": {
       "surfaces": [{
         "nodeName": "MonitorSurfacePlane",
         "kind": "screen",
         "normalSide": "positive"
       }]
     }
   }
   ```
4. **Run analysis**: `pnpm props:analyze` - scans models, detects surfaces, generates `generated/prop-analysis.json`
5. **Generate catalog entries**: `pnpm props:generate` - creates TypeScript entries in `generated/prop-catalog-entries.ts`
6. **Copy to catalog**: Copy generated entries to `apps/web/src/data/propCatalog.ts`
7. **Test and adjust scales**: Spawn props in app, note which need `defaultScale` adjustments, update catalog
8. **Mark approved**: Add filenames to `prop-approved.json` to skip in future analysis runs

**Key Files:**
- `scripts/analyze-props.ts` - GLB analysis script
- `scripts/generate-catalog.ts` - Catalog code generator
- `prop-overrides.json` - Manual surface configuration
- `prop-approved.json` - Batch tracking (skip processed props)
- `apps/web/src/data/propCatalog.ts` - Main prop catalog

**Surface Kinds:**
- `'desk'` - Horizontal work surfaces
- `'screen'` - Vertical display surfaces (monitors)
- `'wall'` - Vertical board surfaces (whiteboards)
- `'monitor-arm'` - Monitor mounting surfaces

**Node Naming Conventions:**
- Pattern-based detection matches: `*Surface*`, `*Plane*`, `*Screen*`, `*Board*`
- Surface nodes must have actual mesh geometry (Empties won't work - `surfaceAdapter.ts` requires `mesh.isMesh`)
- Duplicate surface faces and parent to main object for clean hierarchy

**Manual Prop Addition (Legacy - Not Recommended):**
For one-off props, you can manually add to catalog:
```tsx
{
  id: 'my-prop',
  label: 'My Prop',
  url: '/models/my-prop.glb',
  anchor: { type: 'bbox', align: { x: 'center', y: 'min', z: 'center' } },
  defaultScale: 1.5, // Optional: scale correction
  surfaces: [/* optional */],
}
```

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
