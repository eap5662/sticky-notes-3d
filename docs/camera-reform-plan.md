# Camera System Reform Plan (v1.0)

## 1. Current Architecture Audit

**Controllers**
- `CameraRigController` (canvas/Cameras) – wraps `camera-controls`, reading view configs to position/animate the camera.
- Legacy `DeskViewController`/`ScreenViewController` have been removed in favor of the unified rig.

**State**
- `cameraSlice` exposes `mode`, `yaw`, `pitch`, `dolly`, and per-view defaults (`defaults.wide`, `defaults.screen`). Clamps are now sourced from `cameraViews`.
- `useAutoLayout` computes a layout frame and desk camera defaults, updating `layoutFrameStore` (`frame`, `cameraTarget`, etc.).

**Mode Switching**
- `cameraSlice.mode` now holds `'wide' | 'screen'`; `CameraRigController` respects this and animates transitions with `cameraControls.setLookAt`.

**Pain Points**
- “Desk view” is misnamed and behaves like the original prototype’s “camera around everything,” not a purposeful WideView.
- Transition between modes is abrupt; no interpolation or timed easing.
- Controls + clamps are static; retooling them is awkward (hard-coded values, separated defaults).
- Scaling desk anchor used to cause camera misalignment (now fixed, but the plan should leverage this new floor reference).
- The camera system doesn’t encapsulate future requirements (sticky-note screen editing) or potential additional views (e.g. side, top, custom saved angles).


## 2. Design Objectives for v1.0

1. **Rename & clarify semantics**
   - `DeskView` ➝ **WideView** (default shot showing entire workspace).
   - Keep `ScreenView` label for now (future rename possible once we add note-edit UX).

2. **Predictable camera rigs**
   - Each view defines: anchor target, orbit behavior, dolly range, allowable pitch/yaw, control scheme.
   - Default view should feel anchored to a logical tripod position in the room, not loosely orbiting the desk center.

3. **Graceful transitions**
   - `camera-controls` handles both user input and animated focus transitions between views with damping.
   - Preserve interaction (pointer orbit/dolly) once the transition completes; disable controls only while prop drags lock the camera.

4. **Config-driven & extensible**
   - Allow future “note editing,” “ceiling overview,” or “custom bookmark” views without rewriting controllers.
   - Single state machine driving transitions, clamps, and input mapping.

5. **User-friendly controls**
   - In WideView: orbit around a virtual tripod head (less than 360°), dolly works like “step closer / further.”
   - In ScreenView: orbit constrained tightly, dolly scales screen occupancy.
   - Ensure camera inputs respond only when not locked by prop interactions (respect `cameraInteractionStore`).


## 3. Proposed Architecture

### 3.1 View Definitions
Create a `cameraViews.ts` module that exports a registry:
```ts
type ViewId = 'wide' | 'screen';
type CameraViewConfig = {
  label: string;
  getTarget: (context: LayoutFrameContext) => TargetDefinition;
  clamps: CameraClamps;            // yaw/pitch/dolly min/max
  defaultPose: CameraPose;         // fallback when layout not ready
  orbitSensitivity: { yaw: number; pitch: number };
  dollyStep: number;
  pointerEnabled: boolean;
};
```
- `getTarget` can use `layoutFrame` (Wide) or screen surface metadata (Screen).
- Configs replace hard-coded `CAMERA_CLAMPS` / `STATIC_DEFAULTS`.

### 3.2 State Refactor
- Extend `cameraSlice`:
  - `mode` ➝ `{ kind: 'wide' | 'screen'; viewId: ViewId; transition?: TransitionState }`.
  - `viewConfig = cameraViews[current.viewId]`.
  - Store previous pose for smooth return when switching back (e.g. remember last WideView yaw/pitch/dolly).
  - Composition-friendly actions: `beginTransition(toViewId)` that kicks off interpolation, `completeTransition`.

### 3.3 Controllers Refactor
- Merge `DeskViewController` & `ScreenViewController` into a single `CameraRigController` that:
  1. Instantiates a `CameraControls` instance bound to the active R3F camera.
  2. Configures per-view clamps (azimuth/polar/distance) from the view registry.
  3. Enables/disables zoom/pan/orbit based on view config.
  4. Listens to store updates to keep `cameraSlice` in sync with `cameraControls` (and vice versa).

### 3.4 Transition Mechanism (Camera-Controls)
- On mode change request:
  - Freeze manual input (disable pointer handling / lock `CameraControls.enabled`).
  - Capture current camera pose/target.
  - Compute destination target & desired offset from next view config.
  - Call `cameraControls.setLookAt(cx,cy,cz, tx,ty,tz, true)` with tuned damping; await the promise.
  - Once the promise resolves, update `cameraSlice` with the new pose, re-enable input, and finish the transition state.
- Optionally show UI hint (e.g. “Entering Screen View…”).

### 3.5 Layout Integration
- `useAutoLayout` already updates desk camera defaults; adjust to populate `cameraSlice.setDefaultPose('wide', …)` during layout resolution.
- For ScreenView: compute default from monitor target (center + offset). Provide a fallback if no screen surface present (maybe degrade gracefully to WideView with a toast).
- When layout frame updates (desk moves/rotates), update active view target in place. If transition running, re-evaluate `toTarget` so animation stays accurate.

### 3.6 Naming & UI Hooks
- Rename files/imports: `DeskViewController.tsx` ➝ `WideViewController.tsx` (or delete once merged).
- Update `SceneRoot` to use the new `CameraRigController`.
- Update mode toggles/shortcuts to call `cameraSlice.beginTransition('screen')`, etc.
- Audit any string labels (“Desk View”) in UI components (e.g. toggles, tooltips).


## 4. Implementation Roadmap

1. **Housekeeping**
   - Remove legacy Desk/Screen controllers; wire `CameraRigController` everywhere.
   - Rename `mode.kind === 'desk'` to `'wide'` across codebase (SceneRoot, camera toggles, delete button).

2. **Config Extraction**
   - Introduce `cameraViews.ts` with configs for `wide` & `screen`.
   - Migrate clamps/defaults to this registry.

3. **cameraSlice Upgrade**
   - Add `activeViewId`, `pendingTransition`, `fromPose/target`, `toPose/target`.
   - Provide actions: `requestView(viewId)`, `tickTransition(dt)`, `applyPose`.

4. **CameraRigController**
   - Consolidate logic from both controllers.
   - Own the `CameraControls` instance lifecycle.
   - During transition, call Camera-Controls animated methods; otherwise allow user input with configured clamps.

5. **SceneRoot Wiring**
   - Replace controller conditional with single `CameraRigController`.
   - Hook view switching UI (e.g., clicking monitor) to `requestView('screen')`.
   - Pause desk keyboard driving during transitions.

6. **Layout Hooks**
   - Ensure `useAutoLayout` loads the new view defaults.
   - Move fallback `FALLBACK_DESK_TARGET` → `cameraViews.wide.default`.

7. **QA Pass**
   - Desk spawn without layout target -> WideView fallback.
   - Transition Wide ➝ Screen ➝ Wide; ensure camera returns to previous pose/dolly.
   - Rescale desk / move monitor, verify targets update (no popping).
   - Validate pointer orbit behavior respects new clamps and unlock rules.

8. **Optional Enhancements**
   - Add transition SFX or subtle vignette to emphasize “focus mode”.
   - Expose debug overlay showing current view, target, pose values.
   - Lay groundwork for future views (e.g., `note-edit` preset).


## 5. Testing & Rollout Checklist

- [ ] Keyboard/mouse orbit and dolly in WideView feel natural across clamp range.
- [ ] Transition animation duration & easing tuned (no nausea; < 0.6s recommended).
- [ ] Docked/undocked props, layout changes, and desk movement do not desync camera targets.
- [ ] ScreenView gracefully handles missing monitor surface (fallback to WideView with notice).
- [ ] Regression checks: undo stack, selection cues, desk drive hints still work.
- [ ] Update documentation (`CLAUDE.md`, onboarding docs) referencing new view names and controls.

Delivering this plan establishes a clear, config-driven camera framework that supports the v1.0 WideView default, polished ScreenView transitions, and future view expansions without piecemeal controller work.***
