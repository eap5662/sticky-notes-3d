# Camera System Technical Guide

**Last Updated**: October 2025
**Status**: ✅ Implemented and Working

This document describes the complete architecture of the camera system, including how it aligns with the desk/monitor forward vector, dynamic clamp calculations, and the full data flow from layout computation to camera positioning.

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture Components](#architecture-components)
3. [Coordinate System & Spherical Coordinates](#coordinate-system--spherical-coordinates)
4. [Desk-Relative Camera Alignment](#desk-relative-camera-alignment)
5. [Dynamic Clamp System](#dynamic-clamp-system)
6. [Data Flow](#data-flow)
7. [View Configurations](#view-configurations)
8. [Critical Implementation Details](#critical-implementation-details)
9. [Troubleshooting Guide](#troubleshooting-guide)

---

## Overview

The camera system uses **spherical coordinates** (yaw, pitch, dolly) to position the camera around a target point. The system has two views:

- **Wide View**: Camera positioned in front of the desk, aligned with the desk's forward vector
- **Screen View**: Camera positioned perpendicular to the monitor screen's normal vector

### Key Features

✅ **Desk-relative alignment** - Camera orientation follows desk rotation
✅ **Dynamic yaw clamps** - Constraints adapt to desk/monitor orientation
✅ **Smooth animated transitions** - Powered by `camera-controls` library
✅ **Responsive to layout changes** - Camera updates when desk rotates or props move

---

## Architecture Components

### Core Files

```
apps/web/src/
├── camera/
│   ├── cameraViews.ts          # View configurations (clamps, defaults, target resolvers)
│   └── types.ts                # TypeScript types for camera system
├── canvas/
│   ├── Cameras/
│   │   └── CameraRigController.tsx  # Main camera controller (applies clamps, handles transitions)
│   └── hooks/
│       └── useAutoLayout.ts    # Calculates desk frame and camera poses
└── state/
    ├── cameraSlice.ts          # Zustand store for camera state
    └── layoutFrameStore.ts     # Desk frame and spatial relationships
```

### External Dependencies

- **`camera-controls`** - Three.js camera controller with smooth damping and animation
- **THREE.js** - 3D math (vectors, quaternions, spherical coordinates)

---

## Coordinate System & Spherical Coordinates

### World Space

- **+X** = Right
- **+Y** = Up
- **+Z** = Forward (toward viewer in default orientation)

### Spherical Camera Coordinates

The camera pose is defined by three values:

```typescript
type CameraPose = {
  yaw: number;    // Horizontal angle in radians (rotation around Y-axis)
  pitch: number;  // Vertical angle in radians (elevation)
  dolly: number;  // Distance from target in meters
};
```

#### Yaw (Horizontal Angle)

- **0°** = Camera on +Z axis (facing -Z direction)
- **90° (π/2)** = Camera on +X axis (facing -X direction)
- **180° (π)** = Camera on -Z axis (facing +Z direction)
- **-90° (-π/2)** = Camera on -X axis (facing +X direction)

Calculated from horizontal direction:
```typescript
yaw = Math.atan2(horizontal.x, horizontal.z);
```

#### Pitch (Vertical Angle)

- **0°** = Camera at target height (horizontal)
- **+30°** = Camera above target, looking down
- **-30°** = Camera below target, looking up

#### Dolly (Distance)

Distance in meters from camera to target point. Calculated based on:
- Bounding radius of scene contents
- Field of view (48° default)
- Desired framing margin (1.12x multiplier)

### Converting Pose to Position

```typescript
function poseToPosition(target: [number, number, number], pose: CameraPose): [number, number, number] {
  const [tx, ty, tz] = target;
  const { yaw, pitch, dolly } = pose;

  const px = tx + dolly * Math.cos(pitch) * Math.sin(yaw);
  const py = ty + dolly * Math.sin(pitch);
  const pz = tz + dolly * Math.cos(pitch) * Math.cos(yaw);

  return [px, py, pz];
}
```

**Key Insight**: The camera always looks **at** the target. The yaw/pitch define where the camera sits **relative to** the target in spherical space.

---

## Desk-Relative Camera Alignment

### The Problem

The camera needs to maintain a consistent viewing angle relative to the desk's orientation, even when the desk rotates. A fixed world-space camera position would look wrong when the desk turns.

### The Solution: Layout Frame System

#### Step 1: Build Layout Frame from Desk Surface

The desk's surface metadata (from GLTF extraction) is in **local space**. When the desk rotates (via `genericPropsStore`), we must transform these vectors to **world space**:

```typescript
function buildLayoutFrame(
  meta: SurfaceMeta,
  bounds: GenericPropBounds,
  deskRotationY: number  // Current desk Y-rotation in radians
): LayoutFrame {
  // Start with local-space surface vectors
  let up = toVec3(meta.normal).normalize();      // Desk's "up" direction
  let right = toVec3(meta.uDir).normalize();     // Desk's "right" direction

  // Apply desk Y-rotation to transform to world space
  if (deskRotationY !== 0) {
    const rotationEuler = new THREE.Euler(0, deskRotationY, 0, 'XYZ');
    const rotationQuat = new THREE.Quaternion().setFromEuler(rotationEuler);
    up.applyQuaternion(rotationQuat).normalize();
    right.applyQuaternion(rotationQuat).normalize();
  }

  // Compute forward via cross product (right-handed coordinate system)
  const forward = new THREE.Vector3().crossVectors(right, up).normalize();

  // Re-orthogonalize right (ensure perfect 90° angles)
  right.copy(new THREE.Vector3().crossVectors(up, forward)).normalize();

  return {
    center: meta.center,
    up: toTuple(up),
    right: toTuple(right),
    forward: toTuple(forward),  // THIS is the desk's facing direction
    extents: meta.extents,
    bounds: bounds,
  };
}
```

**Critical**: The `forward` vector points in the direction the desk is facing (where the monitor faces). This is the reference for camera alignment.

#### Step 2: Calculate Camera Pose Relative to Desk Forward

```typescript
function solveCamera(
  frame: LayoutFrame,
  deskBounds: GenericPropBounds
): { target: [number, number, number]; pose: LayoutPose } {
  const forward = toVec3(frame.forward);
  const up = toVec3(frame.up);

  const azimuth = THREE.MathUtils.degToRad(CAMERA_DEFAULT_AZIMUTH_DEG);  // Currently 0°
  const elevation = THREE.MathUtils.degToRad(CAMERA_DEFAULT_ELEVATION_DEG); // 30°

  // Camera should look from IN FRONT of desk (where user sits) BACK toward monitor
  // Step 1: Negate forward to get direction toward user's position
  // Step 2: Apply azimuth rotation around up axis (for future left/right offset)
  const azimuthQuat = new THREE.Quaternion().setFromAxisAngle(up, azimuth);
  const horizontal = forward.clone().negate().applyQuaternion(azimuthQuat).normalize();

  // Extract yaw from horizontal direction ONLY (critical: don't include elevation)
  const yaw = Math.atan2(horizontal.x, horizontal.z);

  // Pitch is simply the elevation angle (kept separate from yaw calculation)
  const pitch = elevation;

  // Calculate dolly based on scene bounds...
  const dolly = /* ... calculation based on bounding radius ... */;

  return {
    target: /* ... desk center with offsets ... */,
    pose: { yaw, pitch, dolly }
  };
}
```

**Why This Works**:

1. **`forward.negate()`** - Flips the desk's facing direction to point toward where the user sits
2. **`azimuthQuat` rotation** - Allows future offset angles (currently 0°, so no effect)
3. **Separate yaw/pitch calculation** - Prevents geometric distortion from mixing horizontal and vertical angles

#### Step 3: Update Camera Store

```typescript
useEffect(() => {
  // ... compute frame and cameraSolution ...

  const cameraStore = useCamera.getState();
  const previousWideDefault = cameraStore.defaults.wide;

  // Update default pose in store
  if (!posesApproximatelyEqual(previousWideDefault, cameraSolution.pose, 1e-4)) {
    cameraStore.setDefaultPose("wide", cameraSolution.pose);

    // If currently in wide view, immediately apply new pose
    if (cameraStore.mode.kind === "wide") {
      cameraStore.setPose(cameraSolution.pose);
    }
  }
}, [deskMeta, deskBounds, deskRotationY, screenMeta]);
```

**Result**: When the desk rotates, `deskRotationY` changes → layout frame recalculates → camera pose updates → camera stays aligned with desk forward direction.

---

## Dynamic Clamp System

### The Challenge

Camera clamps (min/max yaw/pitch/dolly) are configured in `cameraViews.ts` as static values. But:

- **Wide View**: Needs clamps centered around the desk's forward direction (yaw = 90° in typical orientation)
- **Screen View**: Needs clamps centered around the monitor's normal vector (which could be any angle)

### Solution for Wide View: Static Clamps at 90°

Since the desk alignment calculation **always** produces yaw ≈ 90° (camera on +X axis looking toward -X):

```typescript
// cameraViews.ts
wide: {
  clamps: {
    yaw: { min: 45°, max: 135° },  // ±45° around 90° (the calculated aligned position)
    pitch: { min: -12°, max: 50° },
    dolly: { min: 2.7, max: 4.8 }
  },
  defaultPose: {
    yaw: 90°,   // Matches the calculated value
    pitch: 30°,
    dolly: 3.8
  }
}
```

**Why This Works**: The calculation is **deterministic**. Given a desk with forward = [-1, 0, 0], the camera will always be positioned at yaw = 90°. The clamps are designed around this known value.

### Solution for Screen View: Dynamic Clamps

The monitor can be at any angle (depending on desk rotation and monitor placement). The screen view yaw is calculated by `solveScreenCamera()` based on the screen's normal vector:

```typescript
function solveScreenCamera(meta: SurfaceMeta): LayoutPose {
  const normal = toVec3(meta.normal);

  // Camera should be opposite screen normal (looking AT the screen)
  const cameraOffset = normal.clone().negate().normalize();

  // Convert to spherical coordinates
  const yaw = Math.atan2(cameraOffset.x, cameraOffset.z);
  const pitch = Math.asin(THREE.MathUtils.clamp(cameraOffset.y, -1, 1));

  // ... dolly calculation ...

  return { yaw, pitch, dolly };
}
```

This yaw could be **any value** (0°, 45°, 90°, -120°, etc.). So we apply clamps **dynamically** in `CameraRigController`:

```typescript
// CameraRigController.tsx
useEffect(() => {
  const controls = controlsRef.current;
  if (!controls) return;
  const { clamps, pointerEnabled } = viewConfig;

  // For screen view, apply dynamic yaw clamps centered around calculated pose
  if (activeViewId === 'screen') {
    const screenPose = defaults.screen;  // Calculated by solveScreenCamera()
    const clampRange = (30 * Math.PI) / 180;  // ±30°

    controls.minAzimuthAngle = screenPose.yaw - clampRange;
    controls.maxAzimuthAngle = screenPose.yaw + clampRange;
  } else {
    // Wide view uses static clamps from config
    controls.minAzimuthAngle = clamps.yaw.min;
    controls.maxAzimuthAngle = clamps.yaw.max;
  }

  // Pitch and dolly clamps are always static
  controls.minPolarAngle = Math.PI / 2 - clamps.pitch.max;
  controls.maxPolarAngle = Math.PI / 2 - clamps.pitch.min;
  controls.minDistance = clamps.dolly.min;
  controls.maxDistance = clamps.dolly.max;

  // ...
}, [viewConfig, activeViewId, defaults]);
```

**Key Points**:

1. **`defaults.screen`** contains the calculated pose from `solveScreenCamera()`
2. **Clamps are applied as offsets** (`screenPose.yaw ± 30°`)
3. **Effect re-runs** when `defaults` changes (i.e., when monitor rotates or layout updates)

**Result**: Screen view always centers on the monitor and allows ±30° orbiting, regardless of monitor orientation.

---

## Data Flow

### Complete Flow from Desk Rotation to Camera Update

```
1. User rotates desk
   ↓
2. genericPropsStore updates desk rotation[1] (Y-axis)
   ↓
3. useAutoLayout hook detects change via deskRotationY dependency
   ↓
4. buildLayoutFrame() called with new deskRotationY
   ↓
5. Desk surface vectors (up, right, forward) transformed to world space
   ↓
6. solveCamera() calculates new yaw/pitch/dolly relative to transformed forward vector
   ↓
7. cameraStore.setDefaultPose("wide", newPose) called
   ↓
8. If in wide view: cameraStore.setPose(newPose) called immediately
   ↓
9. CameraRigController detects pose change via useCamera((s) => s.yaw/pitch/dolly)
   ↓
10. Effect on line 145 triggers (defaults changed)
    ↓
11. controls.setLookAt() called with new camera position
    ↓
12. camera-controls animates camera to new position (smooth transition)
    ↓
13. Camera maintains alignment with desk forward direction ✅
```

### View Switching Flow (Wide → Screen)

```
1. User clicks on monitor
   ↓
2. Click handler calls cameraStore.setMode({ kind: 'screen', surfaceId: '...' })
   ↓
3. CameraRigController detects activeViewId change
   ↓
4. Effect on line 145 triggers (activeViewId changed)
   ↓
5. viewChanged = true, shouldUpdate = true
   ↓
6. Desired pose = defaults.screen (from solveScreenCamera)
   ↓
7. Target = screenSurface center (via resolveScreenTarget)
   ↓
8. controls.setLookAt(newCameraPos, screenCenter, true) with animation
   ↓
9. Effect on line 97 updates clamps to dynamic screen view clamps
   ↓
10. Camera smoothly animates to screen-centered position ✅
```

---

## View Configurations

### Wide View (Desk View)

**Purpose**: Default view showing entire workspace from user's perspective

**Target**: Desk center + content bounds center + fine-tuning offsets

**Alignment**: Camera positioned in front of desk (where user sits), looking back toward monitor

**Clamps**:
- **Yaw**: 45° to 135° (±45° around 90° aligned position)
- **Pitch**: -12° to 50° (can look down or up above desk)
- **Dolly**: 2.7m to 4.8m

**Default Pose**:
```typescript
{
  yaw: 90°,   // On +X axis, facing -X (aligned with desk forward)
  pitch: 30°, // Looking down at desk surface
  dolly: 3.8m // Medium distance for comfortable framing
}
```

**Camera Offsets** (fine-tuning adjustments to target):
```typescript
CAMERA_TARGET_FORWARD_OFFSET = 0.05   // Slight push toward monitor
CAMERA_TARGET_RIGHT_OFFSET = -0.08    // Slight shift left for centering
CAMERA_TARGET_UP_OFFSET = 0.18        // Lift target above desk center
```

### Screen View (Monitor View)

**Purpose**: Focused view of monitor screen for reading/editing content

**Target**: Screen surface center (UV 0.5, 0.5)

**Alignment**: Camera perpendicular to screen normal, facing screen head-on

**Clamps**:
- **Yaw**: *Dynamic* - ±30° around calculated screen-facing yaw
- **Pitch**: -30° to 45° (asymmetric: less down, more up)
- **Dolly**: 0.5m to 3.0m (closer range for screen focus)

**Default Pose**: *Dynamic* - calculated by `solveScreenCamera()` based on screen orientation

**Dolly Calculation**:
```typescript
// Frame screen diagonal with 20% margin
const screenDiagonal = Math.hypot(extents.uExtent * 2, extents.vExtent * 2);
const fov = 48° (in radians);
dolly = (screenDiagonal / 2 / Math.tan(fov / 2)) * 1.2;

// Clamp to allowed range
dolly = clampScalar(dolly, 0.5, 3.0);

// Fallback if NaN
if (!Number.isFinite(dolly) || dolly <= 0) {
  dolly = 1.5;
}
```

---

## Critical Implementation Details

### 1. Separating Yaw and Pitch Calculations

**❌ WRONG** (causes geometric distortion):
```typescript
const direction = horizontal * cos(elevation) + up * sin(elevation);
const yaw = Math.atan2(direction.x, direction.z);  // BAD: includes elevation!
const pitch = Math.asin(direction.y);
```

**✅ CORRECT**:
```typescript
const horizontal = /* ... azimuth calculation ... */;
const yaw = Math.atan2(horizontal.x, horizontal.z);  // Pure horizontal angle
const pitch = elevation;  // Kept separate
```

**Why**: Spherical coordinates require **orthogonal** angular components. Mixing elevation into the yaw calculation creates a ~30° error at 30° pitch.

### 2. Avoiding Infinite Re-renders

**❌ WRONG**:
```typescript
const deskRotation = deskProp?.rotation ?? [0, 0, 0];
useEffect(() => {
  // ... layout calculation ...
}, [deskRotation]);  // Array reference changes every render!
```

**✅ CORRECT**:
```typescript
const deskRotationY = deskProp?.rotation[1] ?? 0;  // Primitive value
useEffect(() => {
  // ... layout calculation ...
}, [deskRotationY]);  // Only changes when Y-rotation actually changes
```

### 3. Clamp Range Requirements

For the camera to reach its calculated default pose, the clamps **must include** the default value:

```typescript
defaultPose.yaw = 90°;
clamps.yaw.min = 45°;  // ✅ 90° is within [45°, 135°]
clamps.yaw.max = 135°;

// If clamps were too narrow:
defaultPose.yaw = 90°;
clamps.yaw.min = 0°;   // ❌ camera-controls clamps to 45°
clamps.yaw.max = 45°;  // Camera can't reach intended 90° position!
```

### 4. Camera-Controls Coordinate Mapping

`camera-controls` uses different terminology:

| Our Term | camera-controls Term | Mapping |
|----------|---------------------|---------|
| yaw | azimuthAngle | Direct (both in radians around Y-axis) |
| pitch | polarAngle | **Inverted**: `polarAngle = π/2 - pitch` |
| dolly | distance | Direct (both in meters) |

**Polar Angle Conversion**:
```typescript
// pitch = 0° (horizontal) → polarAngle = π/2 (90°, equator)
// pitch = +30° (up) → polarAngle = π/2 - 30° = 60° (above equator)
// pitch = -30° (down) → polarAngle = π/2 + 30° = 120° (below equator)

controls.minPolarAngle = Math.PI / 2 - clamps.pitch.max;  // Most upward
controls.maxPolarAngle = Math.PI / 2 - clamps.pitch.min;  // Most downward
```

### 5. Hardcoded vs. Calculated Defaults

There are **two** sets of default poses:

1. **Hardcoded** in `cameraViews.ts` - Used on initial page load before layout calculates
2. **Calculated** in `useAutoLayout.ts` - Dynamic values based on actual desk/screen geometry

**Best Practice**: Keep hardcoded defaults **in sync** with typical calculated values to avoid camera "jump" on page load.

For Wide View:
```typescript
// cameraViews.ts
defaultPose: {
  yaw: 90°,   // Matches CAMERA_DEFAULT_AZIMUTH_DEG calculation
  pitch: 30°, // Matches CAMERA_DEFAULT_ELEVATION_DEG
  dolly: 3.8
}
```

For Screen View:
```typescript
// cameraViews.ts (placeholders)
defaultPose: {
  yaw: -10°,   // Overridden immediately by solveScreenCamera()
  pitch: -4°,  // Marked as placeholders in comments
  dolly: 1.7
}
```

---

## Troubleshooting Guide

### Camera Doesn't Align with Desk Forward Vector

**Symptoms**: Camera has angular offset from desk direction, doesn't update when desk rotates

**Diagnosis**:
1. Check console for calculated yaw value from `solveCamera()`
2. Verify `deskRotationY` is updating in `useAutoLayout` effect
3. Confirm clamps include the calculated yaw (e.g., 90° must be within [45°, 135°])

**Common Causes**:
- **Clamps too narrow** → Widen `clamps.yaw` range
- **Hardcoded defaults don't match calculated** → Update `cameraViews.ts` defaults
- **Effect not re-running** → Check dependencies array includes `deskRotationY`

### Screen View Zooms to Wrong Position

**Symptoms**: Camera offset to side/back of monitor instead of centered on screen

**Diagnosis**:
1. Check if `solveScreenCamera()` is being called (add console.log)
2. Verify `screenMeta` exists and has valid `normal` vector
3. Confirm dynamic clamps are being applied in `CameraRigController`

**Common Causes**:
- **Static clamps being used** → Ensure `if (activeViewId === 'screen')` branch executes
- **Screen surface not registered** → Check surface registration in monitor prop
- **NaN dolly value** → Verify `extents.uExtent/vExtent` are defined

### Camera "Jumps" on Page Load

**Symptoms**: Camera starts at one position, then suddenly moves after ~100ms

**Diagnosis**:
1. Check if hardcoded `defaultPose` matches calculated pose
2. Verify layout calculation completes before first render

**Fix**: Update hardcoded defaults in `cameraViews.ts` to match typical calculated values

### Infinite Re-render Loop

**Symptoms**: Console logs repeat thousands of times, browser freezes

**Diagnosis**:
1. Check `useEffect` dependencies for array/object references
2. Look for state updates inside effects without proper guards

**Common Causes**:
- **Array dependency** (e.g., `deskRotation`) → Extract primitive value (e.g., `deskRotationY`)
- **Object recreation** in effect → Use `useMemo` or move outside component

### Camera Can't Reach Desired Angle

**Symptoms**: Camera stops rotating before reaching calculated position

**Diagnosis**:
1. Console.log the calculated yaw/pitch and the clamp values
2. Check if calculated pose is **outside** clamp range

**Fix**: Adjust clamps in `cameraViews.ts` to include the calculated pose value

---

## Future Enhancements

### Potential Improvements

1. **Relative Azimuth Constant**
   - Currently `CAMERA_DEFAULT_AZIMUTH_DEG = 0` (no offset)
   - Could be set to -35° for front-right view, or +45° for side view
   - Quaternion rotation already supports this, just needs constant changed

2. **Multiple Saved Camera Positions**
   - Extend `ViewId` type: `'wide' | 'screen' | 'topDown' | 'custom1'`
   - Add UI for saving/loading custom camera bookmarks

3. **Screen View Auto-Framing**
   - Detect visible sticky notes on screen
   - Adjust dolly to frame selected note group

4. **Transition Customization**
   - Expose `camera-controls` damping parameters
   - Allow faster/slower transitions per view

5. **Debug Visualization**
   - Add toggle to show desk forward vector (green line)
   - Display current yaw/pitch/dolly in HUD
   - Visualize clamp boundaries (cone overlay)

---

## Glossary

- **Azimuth**: Horizontal rotation angle (yaw) around vertical axis
- **Polar Angle**: Vertical angle from top (0°) to bottom (180°), equivalent to 90° - pitch
- **Dolly**: Camera distance from target (not zoom, which changes FOV)
- **Layout Frame**: Orthonormal coordinate system (up, right, forward) derived from desk surface
- **Surface Metadata**: GLTF-extracted plane data (center, normal, U/V axes, extents)
- **Clamps**: Min/max constraints on camera movement (yaw/pitch/dolly ranges)
- **Pose**: Camera orientation defined by yaw, pitch, dolly (spherical coordinates)
- **Target**: 3D point camera orbits around and looks at

---

## Key Takeaways for Future Instances

1. **The desk forward vector is king** - All camera alignment flows from the layout frame's `forward` direction
2. **Separate yaw and pitch calculations** - Never mix horizontal and vertical angles before extracting yaw
3. **Use primitive values in effect dependencies** - Avoid array/object references that change every render
4. **Clamps must accommodate defaults** - Calculated pose must be within static clamp range
5. **Screen view needs dynamic clamps** - Monitor can face any direction, so clamps adapt to calculated pose
6. **Trust the quaternion math** - Rotating `forward.negate()` around `up` axis correctly handles desk rotation

**This system is complex but deterministic.** If the camera isn't aligning correctly, the issue is almost always:
- Clamps too narrow
- Yaw calculated incorrectly (including elevation component)
- Effect not re-running (missing dependency)
- Hardcoded defaults don't match calculated values

When in doubt, add console.logs to `solveCamera()` and compare calculated vs. applied poses.
