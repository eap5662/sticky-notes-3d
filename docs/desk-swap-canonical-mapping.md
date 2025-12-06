# Desk Swap Canonical Mapping Design

_Last updated: 2025-10-27_

## 1. Problem Statement

Desk swaps currently re-map props by projecting each world position onto the replacement desk surface and clamping the resulting UV into the new bounds. This treats props independently, so user-authored layouts drift when the new desk footprint has concavities or different proportions. Props near the missing “bite” of an L desk slide along the edge, formations collapse, and the swap flow feels arbitrary.

We need a deterministic, shape-aware remapping system that:

- Preserves relative placement between props across desk shapes.
- Uses the same polygon data driving surface bounds visualization (no duplicated sources of truth).
- Handles both rectangular and concave desks (L, curved bite).
- Flags genuinely invalid placements without silently relocating them.
- Integrates with the existing swap preview and undo stack.

## 2. Goals & Non-Goals

### Goals
- Encode each prop’s location using a canonical coordinate system derived from the surface polygon.
- Map those canonical coordinates onto any other desk polygon while keeping formations intact.
- Detect when a canonical location falls outside the new polygon and prompt the user with minimal UI.
- Keep the runtime resilient to desk rotations, scales, and axis flips.
- Maintain undo/redo support for desk swaps.

### Non-Goals
- Automatic collision / overlap resolution between props.
- Semantic slotting or per-prop heuristics.
- Persisting canonical coordinates beyond in-memory state (no save-file changes yet).
- Multi-desk simultaneous swaps (still single active desk).

## 3. Key Ideas

1. **Canonical Polygon Basis**  
   Convert the desk surface polygon into a stable 2D basis:
   - Ensure clockwise winding with consistent chirality (`u × v = normal`).
   - Rotate the ring so the starting vertex is deterministic (lowest `u`, then `v`).
   - Sample the perimeter at _N_ evenly spaced arc-length points (e.g. `N = 64`).

2. **Mean Value Coordinates (MVC)**  
   Given any interior point, compute MVC weights relative to the sampled boundary. MVC works on concave simple polygons and yields barycentric‐like weights that sum to 1. The same weight vector can be evaluated on any polygon sampled in the same fashion.

3. **Canonical Attachment Snapshot**  
   For each attached prop we store:
   - `canonicalWeights`: Float32 array of length _N_.
   - `lift`: distance along the surface normal.
   - `yawRel`: rotation relative to desk axes.
   - Optional metadata (`dominantEdges`) to aid error messages / clamping.
   The existing `DockAttachment.surfaceSnapshot` gains a `canonical` payload that includes the sampled ring so we can rehydrate snapshots for undo.

4. **Remap Flow**  
   - To encode, project prop position to UV using `surfaceAdapter` axes, compute MVC weights, cache on attachment.
   - To decode, take the new desk polygon, generate the same _N_ samples, evaluate weights to get UV, ensure point-in-polygon, then unproject back to world using the new axes + stored lift.
   - If point is outside (numerical drift, missing notch), mark the prop as `deskSwap:invalid`.

5. **Minimal Review UX**  
   - Any invalid props cause `deskSwapStore` to enter `reviewPending`.
   - UI: a lightweight fixed div listing each prop with status; scene renders existing red ring highlight.
   - Actions: drag props back inside manually (store re-evaluates on updates) or abort swap via existing cancel.
   - Optional per-prop “auto clamp” button uses nearest boundary projection, but only on explicit user request.

## 4. Data Flow Overview

```
Desk surface extracted → SurfaceMeta { shape: polygon, axes, … }
          │
          ├─> canonicalSampler(meta.shape) → { samples[64], perimeter, winding }
          ├─> canonicalEncode(point, sampler) → weights[64], lift, yawRel
          └─> stored in DockAttachment.surfaceSnapshot.canonical

Swap preview loads new desk → builds sampler for replacement polygon
          │
          ├─> canonicalDecode(weights, sampler) → new UV
          ├─> pointInPolygon(new UV, sampler) ?
          │      ├─ yes → unproject + apply yawRel → new attachment
          │      └─ no  → mark invalid (review flag)
          └─> DeskSwapReviewBanner renders summary
```

## 5. Core APIs

### `canonicalSampler.ts` (new)
- `buildCanonicalSampler(meta: SurfaceMeta, sampleCount = 64): CanonicalSampler`
- `canonicalSampler.ensureWinding()` – flips ring if needed.
- Stores: `samples` (`[u,v][]`), `perimeter`, `cumulativeLengths`.

### `canonicalCoordinates.ts` (new)
- `encodeCanonical(meta, sampler, point, yawRel) -> CanonicalAttachment`
- `decodeCanonical(meta, sampler, attachment) -> { uv, lift, yawRel }`
- Internally uses MVC per [Hormann & Floater 2006].

### Attachment schema change
```ts
type CanonicalSnapshot = {
  sampleCount: number;
  samples: Array<[number, number]>;
  weights: Array<number>;
};

type DockAttachment.surfaceSnapshot = {
  type: 'polygon';
  points: Array<[number, number]>;
  canonical?: CanonicalSnapshot;
  // existing OBB optional
};
```

### Desk swap planner (`deskSwapStore.ts`)
- When computing attachment plans, prefer canonical decode:  
  `if (attachment.surfaceSnapshot?.canonical) { decode } else { fallback to project }`.
- On successful remap, re-encode against the new desk sampler so future swaps use up-to-date weights.
- Track invalid props in a new `invalidPropIds` set; raising the review banner clears selection via `setSelection(null)` and stores `pendingReviewContext`.

## 6. Sprint Plan (1 sprint, 3 work packets)

### Packet A – Canonical utilities & metadata (1 day)
1. Add `canonicalSampler.ts` + unit tests (rectangles, L).
2. Implement mean value coordinate encode/decode helpers with tests.
3. Extend `surfaceMetaStore` to cache sampler per desk surface (lazy compute on first use).
4. Update `surfaceAdapter` to include canonical snapshot in debug output when polygon extraction succeeds.

### Packet B – Attachment schema & encoding (1 day)
1. Update `DockAttachment` snapshot struct + clone helpers (`genericPropsStore`, undo store).
2. When docking (`LayoutControls.handleDock`), compute canonical snapshot and store on attachment.
3. Ensure existing rectangular attachments still work (fallback to rect UV when polygon missing).
4. Migrate in-memory attachments on first use: if polygon meta available but snapshot missing, compute and patch.

### Packet C – Desk swap integration & review UX (1–1.5 days)
1. Replace `planAttachmentForProp` logic with canonical decode; fall back to legacy UV when canonical absent.
2. Track invalid props, emit review flag + red rings (reuse existing highlight component).
3. Implement compact `DeskSwapReviewBanner` component and hook into store events.
4. Add optional “Auto clamp” action (project weights onto nearest valid point).
5. Update tests/docs:  
   - Unit tests for decode/encode roundtrip.  
   - Integration test: rectangle → L swap preserving relative spacing.  
   - Document behavior in this design doc / changelog.

Total effort: ~3.5 days focused work (single sprint). Risk is concentrated in MVC math; unit coverage + visual debugging on sample desks should mitigate.

## 7. Edge Cases & Mitigations

- **Point outside after decode**: due to concave mapping; we detect via winding number and surface review banner.
- **Polygon fails extraction**: fall back to legacy rect workflow; warn in logs; attachments degrade gracefully.
- **Numerical instability near boundary**: clamp UV inward by epsilon before storing weights to avoid division singularities, or regularize by mixing MVC weights with centroid weight when denominator is tiny.
- **Undo/redo**: snapshots include canonical data, so desk swap reversal restores prior placements exactly.

## 8. Testing Strategy

- Unit tests for sampler winding normalization and MVC encode/decode across:
  - Perfect rectangle.
  - Rectangle rotated 45° in world space.
  - L-shaped polygon (modified corner desk sample).
  - Curved bite desk (approximate polygon).
- Jest test for `deskSwapStore`: spawn prop layout, perform swap, verify world positions remain within 1 cm of expected decode.
- Manual QA:  
  - Swap rectangular → rectangular (no invalids).  
  - Rectangular → L (props in notch flagged).  
  - L → rectangular (props slide but relative spacing preserved).  
  - Desk with missing polygon data (ensures fallback).

## 9. Rollout Notes

- Keep logging verbose during initial rollout (`[deskSwapCanonical] encode/decode metrics`) to capture issues.
- Once stable, document canonical mapping in `DESK_SURFACE_BOUNDS_STATUS.md`.
- Potential future work: cluster-level constraints, canonical snapshot persistence, surface holes.

