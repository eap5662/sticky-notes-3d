# Failed Attempt: Monitor Scaling Fix (2025-10-02)

## Problem Statement
When scaling the monitor prop via UI slider, the monitor glitches through the desk surface, moving along a curved path. The position oscillates and is visually broken. Desk scaling works fine; only monitor scaling is affected.

## Root Cause (Confirmed)
The anchor-point compensation logic in `useAutoLayout.ts` (lines 439-454) creates a feedback loop:

```typescript
const footDelta = baseFoot && scaledFoot ? scaledFoot.clone().sub(baseFoot) : new THREE.Vector3(0, 0, 0);
const footLateralOffset = footDelta.dot(frameRight);
const footDepthOffset = footDelta.dot(frameForward);
// ...
lateral: overrides.monitorLateral - footLateralOffset,
depth: overrides.monitorDepth - footDepthOffset,
```

**Why this causes oscillation:**
1. `scaleBoundsFromFoot()` computes scaled bounds from original bounds
2. Foot position changes → offset calculated
3. Offset applied to placement → monitor moves
4. New bounds computed → different foot position → different offset
5. Cycle repeats → oscillation

**The architectural issue:**
The GLTFProp transform hierarchy applies scale between anchor translations:
```
<group position={position}>        ← Layout-computed position
  <group position={anchorTuple}>   ← Anchor from ORIGINAL bounds
    <group scale={scale}>          ← Scale applied here
      <group position={-anchorTuple}>
```
When scale changes, the final world position changes even if `position` is constant, because anchor is from unscaled bounds.

---

## Attempted Fix #1: Detach-Scale-Reattach with Scaling Mode State

### Strategy
Create a "scaling mode" that:
1. Freezes monitor placement while user drags slider
2. Skips layout recomputation during drag
3. On release, runs one clean solve with final scale

### Implementation
- Created `scalingModeStore.ts` - state management for active/inactive scaling
- Created `useScalingMode()` hook
- Modified `useAutoLayout` to early-return when scaling mode active
- Modified `PropScaleControls` to enter/exit scaling mode on pointer events
- Added visual feedback (banner, dimming)

### What Worked ✅
- Banner "Scaling... release to reattach" appeared correctly
- Monitor dimmed to 50% opacity during drag
- Console logging showed state transitions working
- Scaling mode activation/deactivation worked

### What Failed ❌
**Problem 1: Monitor still moved while dragging**
- Even with layout frozen, monitor moved because `monitorScale` prop changed
- Scale changes → GLTFProp re-renders → anchor system shifts world position

**Fix Attempted:** Freeze scale in SceneRoot
```typescript
const monitorScale = scalingMode.active && scalingMode.propId === "monitor1"
  ? scalingMode.startScale  // ← Use frozen scale
  : monitorScaleRaw;
```
**Result:** Monitor froze during drag ✅ BUT...

**Problem 2: Monitor went to glitchy position on release**
- When scaling mode exits, `useAutoLayout` runs with the buggy foot-anchor logic
- Monitor positioned incorrectly (below/above desk on curved path)

### Attempts to Fix Reattachment

#### Attempt 1a: Skip bounds updates during scaling
Modified GLTFProp to not update bounds while scaling mode active.
**Result:** Bounds stale on release → placement used wrong bounds

#### Attempt 1b: Use frozen placement from scaling mode
```typescript
setLayoutState({
  ...prevLayout,
  monitorPlacement: scalingMode.frozenPlacement ?? prevLayout.monitorPlacement,
});
```
**Result:** Still moved because scale was changing, affecting world position through anchor math

#### Attempt 1c: Skip scale dependencies during scaling mode
```typescript
// Only depend on scale when NOT in scaling mode
scalingMode.active && scalingMode.propId === "monitor1" ? null : monitorScaleX,
```
**Result:** Reduced re-renders, but didn't fix core positioning issue

---

## Attempted Fix #2: Remove Foot-Anchor Compensation

### Strategy
Simplify `solveMonitor` call by removing the bloated foot-anchor offset logic entirely.

### Implementation
Removed lines 431-444 from `useAutoLayout.ts`:
```typescript
// REMOVED:
const frameRight = toVec3(frame.right);
const frameForward = toVec3(frame.forward);
const monitorScaleVec = [monitorScaleX, monitorScaleY, monitorScaleZ];
const baseMonitorBounds = initialMonitorBoundsRef.current;
const scaledMonitorBounds = baseMonitorBounds && hasNonUnitScale(monitorScaleVec)
  ? scaleBoundsFromFoot(baseMonitorBounds, monitorScaleVec)
  : baseMonitorBounds;
const baseFoot = initialMonitorFootRef.current ?? ...;
const scaledFoot = scaledMonitorBounds ? boundsBottomCenter(scaledMonitorBounds) : baseFoot;
const footDelta = baseFoot && scaledFoot ? scaledFoot.clone().sub(baseFoot) : ...;
const footLateralOffset = footDelta.dot(frameRight);
const footDepthOffset = footDelta.dot(frameForward);
```

Changed `solveMonitor` call to:
```typescript
solveMonitor(
  frame,
  deskSurface,
  monitorMeta,
  monitorBounds ?? null,
  initialMonitorMetaRef.current,
  null, // ← baseBounds set to null
  { lateral: overrides.monitorLateral, depth: overrides.monitorDepth },
  null, // ← scaledBounds set to null
);
```

### What Failed ❌
**CRITICAL FAILURE - Scene broke on load**
- Monitor oscillated rapidly between two positions on initial render
- When scaling attempted, monitor position coordinates ballooned to 10000x
- Monitor started rotating in circles
- Entire scene became unusable

**Root cause of failure:**
By setting `baseBounds: null`, the fallback logic in `solveMonitor` broke:
```typescript
const referenceBounds = scaledBounds ?? baseBounds ?? currentBounds;
if (!referenceBounds && !baseMeta) {
  return null; // ← Placement became null
}
```
During initial load, `currentBounds` is `null` (GLTFProp hasn't computed it yet), so placement returned `null`, causing chaos.

**Lesson:** The `baseBounds` fallback is a **critical safety net** for initial render. Cannot be removed without replacement.

---

## Key Insights for Future Attempts

### What We Confirmed
1. **The foot-anchor compensation IS the problem** - Not just a theory, confirmed through testing
2. **Detach-while-scaling DOES work** - Visual freeze was successful
3. **The reattachment uses the buggy logic** - That's why release fails
4. **baseBounds cannot be null** - It's required for initial render

### What We Don't Know Yet
1. **Why does desk scaling work?**
   - Desk is the reference frame itself, so maybe different code path?
   - Or desk doesn't use foot-anchor compensation?
   - Need to trace desk scaling flow vs monitor scaling flow

2. **What is `scaleBoundsFromFoot()` trying to achieve?**
   - Preserves foot position, but why?
   - Is this for stand alignment (future feature mentioned in docs)?
   - Can we compute this differently?

3. **Can we change the anchor system?**
   - What if anchor was based on scaled bounds instead of original?
   - Would this break other props (desk, future keyboard/lamp)?

### Architecture Constraints Discovered

**GLTFProp Transform Hierarchy:**
```
Outer group: position (from layout) + rotation
  ↓
  Anchor translation (from ORIGINAL bounds)
    ↓
    Scale group (scale applied here)
      ↓
      Negative anchor translation
        ↓
        GLTF scene
```

**Key issue:** Anchor is computed once from original (unscaled) scene bounds. When scale changes, anchor stays the same, so effective world position shifts.

**Example:**
- Original monitor height: 0.5m, anchor at bottom (y=0.25m)
- Scale to 1.5x → monitor is now 0.75m tall
- But anchor still at y=0.25m (from original)
- So bottom of monitor is now at `position.y + 0.25m - (0.25m * 1.5) = position.y - 0.125m`
- The monitor "sinks" by 0.125m even though `position` didn't change

### Potential Solutions (Untried)

#### Option A: Scale-Aware Anchors
Modify GLTFProp to recompute anchor when scale changes.

**Pros:**
- Fixes root cause
- Benefits all future props

**Cons:**
- Changes core prop system
- Might break existing desk behavior
- Unknown edge cases

**Implementation sketch:**
```typescript
const anchorVector = React.useMemo(() => {
  const baseAnchor = computeAnchor(scene, anchor);
  if (!baseAnchor || !Array.isArray(scale)) return baseAnchor;
  // Scale the anchor offset itself
  return new THREE.Vector3(
    baseAnchor.x * scale[0],
    baseAnchor.y * scale[1],
    baseAnchor.z * scale[2]
  );
}, [scene, anchor, scale]);
```

#### Option B: Placement-Time Scale Compensation
In `solveMonitor`, compute placement that accounts for anchor shift.

**Pros:**
- Isolated to monitor placement logic
- Doesn't touch GLTFProp

**Cons:**
- Complex math (compensating for compensation)
- Might just recreate the current buggy logic

**Implementation sketch:**
```typescript
// After computing lift/lateral/depth
// Add correction for anchor shift due to scale
const scaleVec = getCurrentScale(); // Need to pass this in
const anchorShiftY = originalAnchor.y * (scaleVec[1] - 1);
liftDelta += anchorShiftY;
```

#### Option C: Two-Pass Approach
1. Scale the monitor (bounds update)
2. Wait one frame
3. Run placement solve with updated bounds

**Pros:**
- Uses actual scaled bounds, not computed ones
- Avoids math errors

**Cons:**
- Timing-dependent
- Visual "pop" on frame 2
- Fragile if render timing changes

**Implementation sketch:**
```typescript
const [pendingScale, setPendingScale] = useState(null);

useEffect(() => {
  if (pendingScale && monitorBounds) {
    // Bounds have updated, now solve placement
    runPlacementSolve();
    setPendingScale(null);
  }
}, [pendingScale, monitorBounds]);
```

#### Option D: Remove Scaling Feature for Monitor
Simplest solution: Only allow desk scaling, disable monitor scaling UI.

**Pros:**
- No code changes needed
- Avoids entire problem

**Cons:**
- Reduces functionality
- User expectation mismatch (why can desk scale but not monitor?)

---

## What NOT to Try Again

### ❌ Setting baseBounds to null
**Why it fails:** Breaks initial render fallback logic. Placement becomes null → chaos.

### ❌ Using scaledBounds computed from original bounds
**Why it fails:** `scaleBoundsFromFoot()` math doesn't match actual anchor behavior.

### ❌ Freezing placement without freezing scale
**Why it fails:** Scale changes shift world position through anchor system.

### ❌ Complex dependency array tricks in useAutoLayout
**Why it fails:** Doesn't address root cause, just masks symptoms. Still uses buggy logic on release.

---

## Recommended Next Steps

1. **Understand desk scaling** - Why does it work? Trace the code path. Might reveal why monitor is different.

2. **Test Option A (scale-aware anchors)** - Most likely to succeed, but requires careful testing of desk behavior.

3. **Profile the math** - Create a standalone test that shows:
   - Original position at scale 1.0
   - Expected position at scale 1.5
   - Actual position at scale 1.5
   - What the current code computes
   - What it should compute

4. **Consider if this is worth fixing** - Is monitor scaling critical? Or can we ship without it?

---

## Files Modified During Failed Attempt

**Created (now deleted):**
- `apps/web/src/state/scalingModeStore.ts`
- `apps/web/src/canvas/hooks/useScalingMode.ts`

**Modified (reverted):**
- `apps/web/src/canvas/hooks/useAutoLayout.ts`
- `apps/web/src/app/canvas/SceneRoot.tsx`
- `apps/web/src/canvas/props/GLTFProp.tsx`
- `apps/web/src/canvas/props/MonitorProp.tsx`
- `apps/web/src/canvas/PropScaleControls.tsx`

All changes reverted via `git checkout`.

---

## Time Investment
Approximately 4-5 hours of development + debugging.

**Wins:**
- Confirmed root cause
- Proved detach-while-scaling works
- Identified architectural constraints
- Ruled out several dead ends

**Losses:**
- No working fix
- Scaling still broken
- User feature not delivered

**Net result:** Better understanding of problem, but no solution. Future attempts should focus on Option A (scale-aware anchors) or Option D (disable feature).
