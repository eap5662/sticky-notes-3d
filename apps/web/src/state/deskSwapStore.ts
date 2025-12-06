import { create } from 'zustand';

import type { PropCatalogEntry } from '@/data/propCatalog';
import { PROP_CATALOG } from '@/data/propCatalog';
import {
  spawnGenericProp,
  deleteGenericProp,
  getGenericProp,
  getGenericPropsSnapshot,
  setGenericPropStatus,
  setGenericPropLocked,
  createSnapshotFromProp,
  setGenericPropPosition,
  setGenericPropRotation,
  dockPropWithAttachment,
  dockPropWithOffset,
  undockProp,
  setDockOffset,
  setDockAttachment,
  type DockAttachment,
  type DockOffset,
  type DockState,
  type GenericProp,
  type Vec3,
} from '@/state/genericPropsStore';
import { useUndoHistoryStore, type DeskSwapAttachmentSnapshot } from '@/state/undoHistoryStore';
import { setSelection } from '@/state/selectionStore';
import type { SurfaceMeta } from '@/state/surfaceMetaStore';
import {
  clampNormalizedUV,
  normalizedUVToProjected,
  projectPointToNormalized,
  projectPointToSurface,
  unprojectFromSurface,
  isUVInsideSurface,
} from '@/canvas/math/surfaceFrame';
import { getAllSurfaceMeta } from '@/state/surfaceMetaStore';
import { decodeCanonical, encodeCanonical, type CanonicalSnapshot } from '@/canvas/math/canonicalCoordinates';
import { createSurfaceId } from '@/canvas/surfaces';
import { prefetchDeskSurfaces } from '@/canvas/deskSurfacePrefetch';

export type DeskSwapAttachmentPreviewStatus = 'ok' | 'clamped' | 'failed';

export type DeskSwapAttachmentPreview = {
  propId: string;
  label: string;
  status: DeskSwapAttachmentPreviewStatus;
  reason?: string;
  notice?: 'repositioned';
  plan?: AttachmentPlan | null;
};

export type DeskSwapPreviewSurface = {
  baseSurfaceId: string;
  meta: SurfaceMeta | null;
};

export type DeskSwapPreviewAnalysis = {
  catalogId: string;
  surfaces: Record<string, SurfaceMeta | null>;
  attachments: DeskSwapAttachmentPreview[];
};

export type DeskSwapReviewContext = {
  entry: PropCatalogEntry;
  attachments: DeskSwapAttachmentPreview[];
};

type DeskSwapCachedPreview = {
  surfaces: Record<string, SurfaceMeta | null>;
  attachments: DeskSwapAttachmentPreview[];
  updatedAt: number;
};

type DeskSwapCompletionRequest = {
  entry: PropCatalogEntry;
  options?: { force?: boolean };
};

type DeskSwapState = {
  active: boolean;
  targetDeskId: string | null;
  previewEntry: PropCatalogEntry | null;
  previewAnalysis: DeskSwapPreviewAnalysis | null;
  pendingReview: DeskSwapReviewContext | null;
  pendingCompletion: DeskSwapCompletionRequest | null;
  cachedPreviews: Record<string, DeskSwapCachedPreview>;
  previewRequestId: number;
  begin: (deskId: string) => void;
  cancel: () => void;
  complete: (entry: PropCatalogEntry, options?: { force?: boolean }) => boolean;
  setPreviewEntry: (entry: PropCatalogEntry | null) => void;
  setPreviewSurfaces: (catalogId: string, surfaces: DeskSwapPreviewSurface[]) => void;
  clearPendingReview: () => void;
};

type AttachmentPlanSurface = {
  kind: 'surface';
  baseSurfaceId: string;
  normalizedUV: { u: number; v: number };
  projectedUV: { u: number; v: number };
  lift: number;
  yawRel: number;
  clampApplied: boolean;
  targetPosition: Vec3;
  sourceInside?: boolean;
  targetInside?: boolean;
  canonicalSampleCount?: number;
};

type AttachmentPlanOffset = {
  kind: 'offset';
  offset: DockOffset;
  clampApplied: boolean;
};

type AttachmentPlan = AttachmentPlanSurface | AttachmentPlanOffset;

function surfacesAreReady(surfaces: Record<string, SurfaceMeta | null> | null | undefined, context?: string) {
  if (!surfaces) {
    console.info('[DeskSwap][surfaceCheck]', { context, ready: false, reason: 'no-surfaces' });
    return false;
  }
  const qualities = Object.fromEntries(
    Object.entries(surfaces).map(([key, meta]) => [key, meta?.quality ?? 'none'])
  );
  const ready = Object.values(qualities).some((quality) => quality === 'confirmed');
  console.info('[DeskSwap][surfaceCheck]', { context, ready, qualities });
  return ready;
}

function cloneAttachment(attachment: DockAttachment | undefined): DockAttachment | undefined {
  if (!attachment) return undefined;
  return {
    ...attachment,
    offsetUV: { ...attachment.offsetUV },
    surfaceSnapshot: attachment.surfaceSnapshot
      ? attachment.surfaceSnapshot.type === 'rect'
        ? {
            ...attachment.surfaceSnapshot,
            canonical: attachment.surfaceSnapshot.canonical
              ? {
                  sampleCount: attachment.surfaceSnapshot.canonical.sampleCount,
                  samples: attachment.surfaceSnapshot.canonical.samples.map(([x, y]) => [x, y] as [number, number]),
                  weights: [...attachment.surfaceSnapshot.canonical.weights],
                }
              : undefined,
          }
        : {
            ...attachment.surfaceSnapshot,
            points: attachment.surfaceSnapshot.points.map(([x, y]) => [x, y] as [number, number]),
            obb: attachment.surfaceSnapshot.obb
              ? {
                  center: [...attachment.surfaceSnapshot.obb.center] as [number, number],
                  right: [...attachment.surfaceSnapshot.obb.right] as [number, number],
                  up: [...attachment.surfaceSnapshot.obb.up] as [number, number],
                  extents: [...attachment.surfaceSnapshot.obb.extents] as [number, number],
                }
              : undefined,
            canonical: attachment.surfaceSnapshot.canonical
              ? {
                  sampleCount: attachment.surfaceSnapshot.canonical.sampleCount,
                  samples: attachment.surfaceSnapshot.canonical.samples.map(([x, y]) => [x, y] as [number, number]),
                  weights: [...attachment.surfaceSnapshot.canonical.weights],
                }
              : undefined,
          }
      : undefined,
  };
}

function cloneOffset(offset: DockOffset | undefined): DockOffset | undefined {
  if (!offset) return undefined;
  return { ...offset };
}

function convertToCanonicalSnapshot(
  snapshot: { sampleCount: number; samples: Array<[number, number]>; weights: number[] } | undefined,
): CanonicalSnapshot | null {
  if (!snapshot) return null;
  return {
    sampleCount: snapshot.sampleCount,
    samples: snapshot.samples.map(([x, y]) => [x, y] as [number, number]),
    weights: Float32Array.from(snapshot.weights),
  };
}

function getBaseSurfaceId(surfaceId: string | undefined): string | null {
  if (!surfaceId) return null;
  const parts = surfaceId.split(':');
  return parts[parts.length - 1] ?? null;
}

const CLAMP_EPSILON = 1e-4;

const UV_EPSILON = 1e-5;

const LIFT_EPSILON = 5e-4;

function getPrimaryDeskSurface(surfaceMap: Record<string, SurfaceMeta | null>) {
  let fallback: { baseSurfaceId: string; meta: SurfaceMeta } | null = null;
  for (const [baseSurfaceId, meta] of Object.entries(surfaceMap)) {
    if (!meta) continue;
    if (meta.kind === 'desk') {
      return { baseSurfaceId, meta };
    }
    if (!fallback) {
      fallback = { baseSurfaceId, meta };
    }
  }
  return fallback;
}

function normalizeAngle(angle: number) {
  const twoPi = Math.PI * 2;
  let result = angle % twoPi;
  if (result > Math.PI) {
    result -= twoPi;
  } else if (result < -Math.PI) {
    result += twoPi;
  }
  return result;
}

function buildSourceSurfaceMap(deskId: string): Record<string, SurfaceMeta | null> {
  const entries = getAllSurfaceMeta();
  const surfaceMap: Record<string, SurfaceMeta | null> = {};
  entries.forEach(([surfaceId, meta]) => {
    if (meta.ownerId !== deskId) return;
    const baseSurfaceId = getBaseSurfaceId(String(surfaceId));
    if (baseSurfaceId) {
      surfaceMap[baseSurfaceId] = meta;
    }
  });
  return surfaceMap;
}

type SurfacePlacementSeed = {
  baseSurfaceId: string;
  meta: SurfaceMeta;
  normalizedUV: { u: number; v: number };
  projectedUV: { u: number; v: number };
  lift: number;
  yawRel: number;
  sourceInside: boolean;
  canonicalSampleCount?: number;
};

function resolveSourcePlacement(
  prop: GenericProp,
  sourceSurfaceMap: Record<string, SurfaceMeta | null>,
  deskYaw: number,
): SurfacePlacementSeed | null {
  const attachment = prop.dockAttachment ?? null;
  const offset = prop.dockOffset ?? null;

  const preferredBaseId = attachment ? getBaseSurfaceId(String(attachment.surfaceId)) : null;
  let baseSurfaceId: string | null = preferredBaseId;
  let meta = baseSurfaceId ? sourceSurfaceMap[baseSurfaceId] ?? null : null;

  if (!meta) {
    const primary = getPrimaryDeskSurface(sourceSurfaceMap);
    if (!primary) {
      return null;
    }
    baseSurfaceId = primary.baseSurfaceId;
    meta = primary.meta;
  }

  const yawRel = attachment?.yawRel ?? offset?.yaw ?? normalizeAngle((prop.rotation[1] ?? 0) - deskYaw);

  let normalizedUV: { u: number; v: number } | null = null;
  let projectedUV: { u: number; v: number } | null = null;
  let lift: number | null = null;
  let sourceInside = false;
  let canonicalSampleCount: number | undefined;

  if (attachment?.surfaceSnapshot?.canonical?.sampleCount) {
    canonicalSampleCount = attachment.surfaceSnapshot.canonical.sampleCount;
  }

  const projection = projectPointToNormalized(meta, prop.position as Vec3);
  if (projection) {
    normalizedUV = projection.normalizedUV;
    projectedUV = projection.projectedUV;
    lift = projection.lift;
    sourceInside = projection.inside;
  }

  if ((!normalizedUV || !sourceInside) && attachment) {
    const decodedSnapshot = convertToCanonicalSnapshot(attachment.surfaceSnapshot?.canonical);
    if (decodedSnapshot) {
      const decoded = decodeCanonical(meta, decodedSnapshot, attachment.lift, yawRel);
      if (decoded) {
        normalizedUV = decoded.uv;
        projectedUV = normalizedUVToProjected(meta, normalizedUV.u, normalizedUV.v);
        lift = decoded.lift;
        sourceInside = true;
        canonicalSampleCount = decodedSnapshot.sampleCount;
      }
    }
  }

  if (!normalizedUV && attachment) {
    normalizedUV = clampNormalizedUV(meta, attachment.offsetUV);
    projectedUV = normalizedUVToProjected(meta, normalizedUV.u, normalizedUV.v);
    lift = attachment.lift;
    sourceInside = isUVInsideSurface(meta, projectedUV.u, projectedUV.v);
  }

  if (!normalizedUV && offset) {
    const normalizedFromOffset = clampNormalizedUV(meta, convertOffsetToNormalized(meta, offset));
    normalizedUV = normalizedFromOffset;
    projectedUV = normalizedUVToProjected(meta, normalizedFromOffset.u, normalizedFromOffset.v);
    lift = offset.lift;
    sourceInside = isUVInsideSurface(meta, projectedUV.u, projectedUV.v);
  }

  if (!normalizedUV || !projectedUV || lift == null || Number.isNaN(lift)) {
    return null;
  }

  const resolvedLift = lift;

  const clampedNormalized = clampNormalizedUV(meta, normalizedUV);
  const clampedProjected = normalizedUVToProjected(meta, clampedNormalized.u, clampedNormalized.v);

  const delta = Math.abs(clampedNormalized.u - normalizedUV.u) + Math.abs(clampedNormalized.v - normalizedUV.v);
  const clampedInside = isUVInsideSurface(meta, clampedProjected.u, clampedProjected.v);

  return {
    baseSurfaceId: baseSurfaceId!,
    meta,
    normalizedUV: clampedNormalized,
    projectedUV: clampedProjected,
    lift: resolvedLift,
    yawRel,
    sourceInside: sourceInside || clampedInside || delta <= CLAMP_EPSILON,
    canonicalSampleCount,
  };
}

function convertOffsetToNormalized(meta: SurfaceMeta, offset: DockOffset): { u: number; v: number } {
  const width = meta.extents.u;
  const depthSpan = meta.extents.v;
  const halfWidth = width / 2;
  const halfDepth = depthSpan / 2;
  const u = halfWidth > UV_EPSILON ? (offset.lateral / halfWidth + 1) * 0.5 : 0.5;
  const v = halfDepth > UV_EPSILON ? (offset.depth / halfDepth + 1) * 0.5 : 0.5;
  return { u, v };
}

function buildSurfacePlan(
  seed: SurfacePlacementSeed,
  targetSurfaceMap: Record<string, SurfaceMeta | null>,
): { plan: AttachmentPlanSurface | null; status: DeskSwapAttachmentPreviewStatus; reason?: string; notice?: 'repositioned' } {
  const preferredMeta = targetSurfaceMap[seed.baseSurfaceId] ?? null;
  const fallbackInfo = preferredMeta ? null : getPrimaryDeskSurface(targetSurfaceMap);
  const resolved = preferredMeta ? { baseSurfaceId: seed.baseSurfaceId, meta: preferredMeta } : fallbackInfo;

  if (!resolved) {
    return {
      plan: null,
      status: 'failed',
      reason: 'Target desk lacks compatible surface',
    };
  }

  const { meta: targetMetaResolved, baseSurfaceId } = resolved;
  const sourceNormal = seed.meta.normal;
  const targetNormal = targetMetaResolved.normal;
  const dotNormals =
    sourceNormal && targetNormal
      ? sourceNormal[0] * targetNormal[0] + sourceNormal[1] * targetNormal[1] + sourceNormal[2] * targetNormal[2]
      : 1;

  const normalizedUV = clampNormalizedUV(targetMetaResolved, seed.normalizedUV);
  const projectedUV = normalizedUVToProjected(targetMetaResolved, normalizedUV.u, normalizedUV.v);
  let clampApplied = Math.abs(normalizedUV.u - seed.normalizedUV.u) + Math.abs(normalizedUV.v - seed.normalizedUV.v) > CLAMP_EPSILON;

  let appliedLift = dotNormals < 0 ? -seed.lift : seed.lift;
  const candidatePosition = unprojectFromSurface(targetMetaResolved, projectedUV.u, projectedUV.v, appliedLift);
  if (!candidatePosition) {
    return {
      plan: null,
      status: 'failed',
      reason: 'Failed to compute placement on target desk',
    };
  }

  const reprojection = projectPointToSurface(targetMetaResolved, candidatePosition);
  let targetPosition: Vec3 = candidatePosition;
  if (reprojection) {
    const liftDelta = Math.abs(reprojection.lift - appliedLift);
    if (liftDelta > LIFT_EPSILON) {
      appliedLift = reprojection.lift;
      const adjusted = unprojectFromSurface(targetMetaResolved, projectedUV.u, projectedUV.v, appliedLift);
      if (adjusted) {
        targetPosition = adjusted;
      }
      clampApplied = true;
    } else {
      appliedLift = reprojection.lift;
    }
  }

  if (!Number.isFinite(appliedLift)) {
    appliedLift = 0;
  }

  const liftAdjustedPosition = unprojectFromSurface(targetMetaResolved, projectedUV.u, projectedUV.v, appliedLift);
  if (liftAdjustedPosition) {
    targetPosition = liftAdjustedPosition;
  }

  const targetInside = isUVInsideSurface(targetMetaResolved, projectedUV.u, projectedUV.v);

  return {
    plan: {
      kind: 'surface',
      baseSurfaceId,
      normalizedUV,
      projectedUV,
      lift: appliedLift,
      yawRel: seed.yawRel,
      clampApplied,
      targetPosition,
      sourceInside: seed.sourceInside,
      targetInside,
      canonicalSampleCount: seed.canonicalSampleCount,
    },
    status: clampApplied ? 'clamped' : 'ok',
    reason: clampApplied ? 'Placement adjusted to stay within desk bounds' : undefined,
    notice: clampApplied ? 'repositioned' : undefined,
  };
}

function realizeAttachmentPlan(
  plan: AttachmentPlan,
  newDeskId: string,
  surfaceMap: Record<string, SurfaceMeta | null>,
): { attachment?: DockAttachment; offset?: DockOffset } {
  if (plan.kind === 'surface') {
    const meta = surfaceMap[plan.baseSurfaceId] ?? null;
    const surfaceId = createSurfaceId(`${newDeskId}:${plan.baseSurfaceId}`);
    let surfaceSnapshot;
    if (meta?.shape) {
      let canonicalSnapshot;
      const projectedUV = normalizedUVToProjected(meta, plan.normalizedUV.u, plan.normalizedUV.v);
      const candidatePoint = unprojectFromSurface(meta, projectedUV.u, projectedUV.v, plan.lift);
      if (candidatePoint) {
        const canonical = encodeCanonical(meta, candidatePoint, plan.yawRel, {
          sampleCount: plan.canonicalSampleCount,
        });
        if (canonical) {
          canonicalSnapshot = {
            sampleCount: canonical.snapshot.sampleCount,
            samples: canonical.snapshot.samples.map(([x, y]) => [x, y] as [number, number]),
            weights: Array.from(canonical.snapshot.weights),
          };
        }
      }

      if (meta.shape.type === 'rect') {
        surfaceSnapshot = {
          type: 'rect' as const,
          width: meta.shape.width,
          height: meta.shape.height,
          canonical: canonicalSnapshot,
        };
      } else if (meta.shape.type === 'polygon') {
        surfaceSnapshot = {
          type: 'polygon' as const,
          points: meta.shape.points.map(([x, y]) => [x, y] as [number, number]),
          canonical: canonicalSnapshot,
        };
      }
    }
    const attachment: DockAttachment = {
      deskInstanceId: newDeskId,
      surfaceId,
      offsetUV: { u: plan.normalizedUV.u, v: plan.normalizedUV.v },
      lift: plan.lift,
      yawRel: plan.yawRel,
      surfaceSnapshot,
    };
    const metaExtents = meta?.extents;
    const width = metaExtents?.u ?? 0;
    const depthSpan = metaExtents?.v ?? 0;
    const offset: DockOffset = {
      lateral: (plan.normalizedUV.u - 0.5) * width,
      depth: (plan.normalizedUV.v - 0.5) * depthSpan,
      lift: plan.lift,
      yaw: plan.yawRel,
    };
    return { attachment, offset };
  }

  return {
    attachment: undefined,
    offset: { ...plan.offset },
  };
}

function updateDeskSwapUndoSnapshots(deskId: string) {
  const undoState = useUndoHistoryStore.getState();
  const { actions } = undoState;
  if (actions.length === 0) {
    return;
  }

  const lastIndex = actions.length - 1;
  const lastAction = actions[lastIndex];
  if (!lastAction || lastAction.type !== 'desk-swap' || lastAction.newDesk.id !== deskId) {
    return;
  }

  const updatedAttachments = lastAction.attachments.map((record) => {
    const prop = getGenericProp(record.propId);
    if (!prop) {
      return record;
    }

    return {
      ...record,
      afterSnapshot: createSnapshotFromProp(prop),
      afterDocked: prop.docked,
      afterAttachment: cloneAttachment(prop.dockAttachment),
      afterOffset: cloneOffset(prop.dockOffset),
      afterState: prop.dockState,
      afterPosition: [prop.position[0], prop.position[1], prop.position[2]] as Vec3,
      afterRotation: [prop.rotation[0], prop.rotation[1], prop.rotation[2]] as Vec3,
    };
  });

  const deskProp = getGenericProp(deskId);
  const updatedAction = {
    ...lastAction,
    newDesk: deskProp ? createSnapshotFromProp(deskProp) : lastAction.newDesk,
    attachments: updatedAttachments,
  };

  useUndoHistoryStore.setState((state) => {
    const nextActions = state.actions.slice();
    nextActions[lastIndex] = updatedAction;
    return { ...state, actions: nextActions };
  });
}

function computeAttachmentPreview(
  props: GenericProp[],
  targetDesk: GenericProp,
  previewEntry: PropCatalogEntry | null,
  targetSurfaceMap: Record<string, SurfaceMeta | null>,
): DeskSwapAttachmentPreview[] {
  if (!previewEntry) return [];

  const allowedSurfaces = new Set<string>(
    (previewEntry.surfaces ?? []).map((surface) => getBaseSurfaceId(String(surface.id))).filter(Boolean) as string[],
  );

  const hasSurfaceDefinitions = allowedSurfaces.size > 0;
  const sourceSurfaceMap = buildSourceSurfaceMap(targetDesk.id);
  const deskYaw = targetDesk.rotation[1] ?? 0;

  const previews: DeskSwapAttachmentPreview[] = [];

  props.forEach((prop) => {
    if (prop.id === targetDesk.id) {
      return;
    }

    const attachmentDeskId = prop.dockAttachment?.deskInstanceId;
    const isAttachedToDesk = attachmentDeskId === targetDesk.id && prop.dockState === 'attached';

    const seed = resolveSourcePlacement(prop, sourceSurfaceMap, deskYaw);
    if (!seed) {
      if (isAttachedToDesk) {
        previews.push({
          propId: prop.id,
          label: prop.label ?? prop.catalogId ?? prop.id,
          status: 'failed',
          reason: 'Unable to resolve placement on current desk',
        });
      }
      return;
    }

    const shouldInclude = isAttachedToDesk || seed.sourceInside;
    if (!shouldInclude) {
      return;
    }

    const planned = buildSurfacePlan(seed, targetSurfaceMap);
    const label = prop.label ?? prop.catalogId ?? prop.id;

    if (!planned.plan) {
      previews.push({
        propId: prop.id,
        label,
        status: planned.status,
        reason: planned.reason,
      });
      return;
    }

    let missingSurface = false;
    if (hasSurfaceDefinitions && prop.dockAttachment) {
      const baseSurfaceId = getBaseSurfaceId(String(prop.dockAttachment.surfaceId));
      if (baseSurfaceId && !allowedSurfaces.has(baseSurfaceId)) {
        missingSurface = true;
      }
    }

    const status = missingSurface && planned.status === 'ok' ? 'clamped' : planned.status;
    const reason = missingSurface
      ? planned.reason ?? 'Remapped to closest surface on new desk'
      : planned.reason;
    const notice = missingSurface ? 'repositioned' : planned.notice;

    previews.push({
      propId: prop.id,
      label,
      status,
      reason,
      notice,
      plan: planned.plan,
    });
  });

  return previews;
}

function remapAttachmentDeskId(attachment: DockAttachment | undefined, nextDeskId: string): DockAttachment | undefined {
  const cloned = cloneAttachment(attachment);
  if (!cloned) return undefined;
  const prevDeskId = cloned.deskInstanceId;
  cloned.deskInstanceId = nextDeskId;
  if (cloned.surfaceId) {
    const prefix = `${prevDeskId}:`;
    if (cloned.surfaceId.startsWith(prefix)) {
      cloned.surfaceId = cloned.surfaceId.replace(prefix, `${nextDeskId}:`);
    }
  }
  return cloned;
}

function applyPreviewResult(
  catalogId: string,
  surfaces: Record<string, SurfaceMeta | null>,
  attachments: DeskSwapAttachmentPreview[],
  applyToActivePreview: boolean,
  setState: (fn: (state: DeskSwapState) => Partial<DeskSwapState>) => void,
  getState: () => DeskSwapState,
) {
  const updatedAt = Date.now();
  console.info('[DeskSwap][preview] applyPreviewResult', {
    catalogId,
    applyToActivePreview,
    surfaceCount: Object.keys(surfaces).length,
    qualities: Object.fromEntries(
      Object.entries(surfaces).map(([k, meta]) => [k, meta?.quality ?? 'none'])
    ),
  });
  setState((state) => {
    const cachedPreviews = { ...state.cachedPreviews };
    cachedPreviews[catalogId] = {
      surfaces,
      attachments,
      updatedAt,
    };

    const result: Partial<DeskSwapState> = {
      cachedPreviews,
    };

    if (applyToActivePreview && state.previewEntry?.id === catalogId) {
      result.previewAnalysis = {
        catalogId,
        surfaces,
        attachments,
      };
      result.pendingReview = null;
    }

    return result;
  });

  const postState = getState();
  const pending = postState.pendingCompletion;
  if (pending && pending.entry.id === catalogId && surfacesAreReady(surfaces, 'applyPreviewResult')) {
    finalizeDeskSwapWithCached(pending.entry, pending.options, setState, getState);
  }
}

function finalizeDeskSwapWithCached(
  entry: PropCatalogEntry,
  options: { force?: boolean } | undefined,
  setState: (fn: (state: DeskSwapState) => Partial<DeskSwapState>) => void,
  getState: () => DeskSwapState,
): boolean {
  const state = getState();
  const { active, targetDeskId, cachedPreviews } = state;
  if (!active || !targetDeskId) {
    return false;
  }

  const oldDesk = getGenericProp(targetDeskId);
  if (!oldDesk) {
    setState(() => ({
      active: false,
      targetDeskId: null,
      pendingReview: null,
      pendingCompletion: null,
    }));
    return false;
  }

  const cached = cachedPreviews[entry.id] ?? null;
  const surfaceMap = cached?.surfaces ?? {};
  const attachments = cached?.attachments ?? [];

  const surfacesReadyNow = surfacesAreReady(surfaceMap, 'complete');
  console.info('[DeskSwap][complete] invoked', {
    entryId: entry.id,
    hasCachedPreview: !!cached,
    surfacesReady: surfacesReadyNow,
    surfaceQualities: Object.fromEntries(
      Object.entries(surfaceMap).map(([key, meta]) => [key, meta?.quality ?? 'none'])
    ),
    pendingCompletion: !!state.pendingCompletion,
  });

  if (!cached || !surfacesReadyNow) {
    const propsSnapshot = getGenericPropsSnapshot();
    const remappableProps = propsSnapshot.filter((prop) => {
      if (prop.id === oldDesk.id) return false;
      const attachedToDesk = prop.dockAttachment?.deskInstanceId === oldDesk.id && prop.dockState === 'attached';
      const hasOffset = !!prop.dockOffset && prop.dockState === 'attached';
      return attachedToDesk || hasOffset;
    });

    if (remappableProps.length > 0) {
      const loadingAttachments: DeskSwapAttachmentPreview[] = remappableProps.map((prop) => ({
        propId: prop.id,
        label: prop.label ?? prop.catalogId ?? prop.id,
        status: 'failed',
        reason: 'Desk surfaces are still loading. Please wait for the preview to finish before completing the swap.',
      }));
      setSelection(null);
      setState(() => ({
        pendingReview: { entry, attachments: loadingAttachments },
        pendingCompletion: { entry, options },
      }));
    } else {
      setState(() => ({
        pendingCompletion: { entry, options },
      }));
    }
    return false;
  }

  const failedAttachments = attachments.filter((attachment) => attachment.status === 'failed');
  if (!options?.force && failedAttachments.length > 0) {
    setSelection(null);
    setState(() => ({
      pendingReview: { entry, attachments },
      pendingCompletion: null,
    }));
    return false;
  }

  setState(() => ({
    pendingCompletion: null,
    pendingReview: null,
  }));

  const oldDeskSnapshot = createSnapshotFromProp(oldDesk);
  const propsSnapshot = getGenericPropsSnapshot();

  const attachmentRecords: DeskSwapAttachmentSnapshot[] = [];
  const propsToReconcile = new Set<string>();
  const needReconcile = !surfacesReadyNow;

  const planByPropId = new Map<string, AttachmentPlan>();
  attachments.forEach((previewAttachment) => {
    if (previewAttachment.plan && previewAttachment.status !== 'failed') {
      planByPropId.set(previewAttachment.propId, previewAttachment.plan);
    }
  });

  const oldCatalogEntry = oldDesk.catalogId
    ? PROP_CATALOG.find((item) => item.id === oldDesk.catalogId)
    : null;
  const oldDefaultScale = oldCatalogEntry?.defaultScale ?? 1;
  const newDefaultScale = entry.defaultScale ?? 1;
  const currentScale = oldDesk.scale[0] ?? newDefaultScale;
  const userScaleMultiplier = oldDefaultScale > 0 ? currentScale / oldDefaultScale : 1;
  const appliedScale = newDefaultScale * userScaleMultiplier;

  const newDeskProp = spawnGenericProp({
    catalogId: entry.id,
    label: entry.label,
    url: entry.url,
    anchor: entry.anchor,
    position: oldDesk.position,
    rotation: oldDesk.rotation,
    scale: [appliedScale, appliedScale, appliedScale],
    locked: oldDesk.locked,
  });
  setGenericPropStatus(newDeskProp.id, 'placed');
  setGenericPropLocked(newDeskProp.id, oldDesk.locked);

  const targetedProps = propsSnapshot.filter((prop) => planByPropId.has(prop.id));
  const fallbackProps = propsSnapshot.filter((prop) => {
    if (planByPropId.has(prop.id)) return false;
    if (prop.id === oldDesk.id) return false;
    if (!prop.dockAttachment) return false;
    return prop.dockAttachment.deskInstanceId === oldDesk.id && prop.dockState === 'attached';
  });

  const newDeskState = getGenericProp(newDeskProp.id) ?? newDeskProp;
  const newDeskYaw = newDeskState.rotation[1] ?? 0;

  targetedProps.forEach((prop) => {
    const plan = planByPropId.get(prop.id);
    if (!plan) {
      return;
    }

    if (needReconcile) {
      propsToReconcile.add(prop.id);
    }

    const beforeAttachment = cloneAttachment(prop.dockAttachment);
    const beforeOffset = cloneOffset(prop.dockOffset);
    const beforeState: DockState = prop.dockState;
    const beforePosition: Vec3 = [prop.position[0], prop.position[1], prop.position[2]];
    const beforeRotation: Vec3 = [prop.rotation[0], prop.rotation[1], prop.rotation[2]];
    const beforeSnapshot = createSnapshotFromProp(prop);

    if (plan.kind === 'surface') {
      const metaDebug = surfaceMap[plan.baseSurfaceId] ?? null;
      console.info('[DeskSwap][applyPlan]', {
        propId: prop.id,
        planKind: plan.kind,
        planBaseSurface: plan.baseSurfaceId,
        planLift: plan.lift,
        metaQuality: metaDebug?.quality ?? 'none',
        metaOrigin: metaDebug?.origin ?? null,
        metaExtents: metaDebug?.extents ?? null,
      });
      if (prop.docked) {
        const realized = realizeAttachmentPlan(plan, newDeskProp.id, surfaceMap);
        if (realized.attachment) {
          dockPropWithAttachment(prop.id, realized.attachment);
        }
        if (realized.offset) {
          if (!realized.attachment) {
            dockPropWithOffset(prop.id, realized.offset);
            setDockAttachment(prop.id, undefined);
          }
          setDockOffset(prop.id, realized.offset);
        }
      } else {
        undockProp(prop.id);
      }

      if (plan.targetPosition) {
        console.info('[DeskSwap][position-set]', {
          propId: prop.id,
          targetPosition: plan.targetPosition,
        });
        setGenericPropPosition(prop.id, plan.targetPosition);
        const currentAfterSet = getGenericProp(prop.id);
        console.info('[DeskSwap][position-after-set]', {
          propId: prop.id,
          position: currentAfterSet?.position ?? null,
        });
      }

      const baseRotation: Vec3 = (getGenericProp(prop.id)?.rotation ?? prop.rotation) as Vec3;
      const yaw = normalizeAngle(newDeskYaw + plan.yawRel);
      setGenericPropRotation(prop.id, [baseRotation[0], yaw, baseRotation[2]]);
    } else {
      console.info('[DeskSwap][applyPlan-offset]', {
        propId: prop.id,
        planKind: plan.kind,
      });
      const realized = realizeAttachmentPlan(plan, newDeskProp.id, surfaceMap);
      if (realized.attachment) {
        dockPropWithAttachment(prop.id, realized.attachment);
      }
      if (realized.offset) {
        dockPropWithOffset(prop.id, realized.offset);
        setDockAttachment(prop.id, undefined);
      }
    }

    const propAfter = getGenericProp(prop.id);
    const afterAttachment = cloneAttachment(propAfter?.dockAttachment);
    const afterOffset = cloneOffset(propAfter?.dockOffset);
    const afterState: DockState = propAfter?.dockState ?? prop.dockState;
    const afterPosition: Vec3 = propAfter
      ? ([propAfter.position[0], propAfter.position[1], propAfter.position[2]] as Vec3)
      : beforePosition;
    const afterRotation: Vec3 = propAfter
      ? ([propAfter.rotation[0], propAfter.rotation[1], propAfter.rotation[2]] as Vec3)
      : beforeRotation;
    const afterSnapshot = propAfter ? createSnapshotFromProp(propAfter) : beforeSnapshot;

    attachmentRecords.push({
      propId: prop.id,
      beforeSnapshot,
      afterSnapshot,
      beforeDocked: prop.docked,
      beforePosition,
      beforeRotation,
      beforeAttachment,
      beforeOffset,
      beforeState,
      afterDocked: propAfter?.docked ?? prop.docked,
      afterPosition,
      afterRotation,
      afterAttachment,
      afterOffset,
      afterState,
    });
  });

  fallbackProps.forEach((prop) => {
    const beforeAttachment = cloneAttachment(prop.dockAttachment);
    const beforeOffset = cloneOffset(prop.dockOffset);
    const beforeState: DockState = prop.dockState;
    const beforePosition: Vec3 = [prop.position[0], prop.position[1], prop.position[2]];
    const beforeRotation: Vec3 = [prop.rotation[0], prop.rotation[1], prop.rotation[2]];
    const beforeSnapshot = createSnapshotFromProp(prop);

    if (needReconcile) {
      propsToReconcile.add(prop.id);
    }

    const fallbackAttachment = remapAttachmentDeskId(beforeAttachment, newDeskProp.id);
    if (fallbackAttachment) {
      console.info('[DeskSwap][fallbackAttachment]', {
        propId: prop.id,
        baseSurfaceId: fallbackAttachment.surfaceId,
      });
      dockPropWithAttachment(prop.id, fallbackAttachment);
    } else if (beforeOffset) {
      dockPropWithOffset(prop.id, beforeOffset);
      setDockAttachment(prop.id, undefined);
    }

    const propAfter = getGenericProp(prop.id);
    const afterAttachment = cloneAttachment(propAfter?.dockAttachment);
    const afterOffset = cloneOffset(propAfter?.dockOffset);
    const afterState: DockState = propAfter?.dockState ?? prop.dockState;
    const afterPosition: Vec3 = propAfter
      ? ([propAfter.position[0], propAfter.position[1], propAfter.position[2]] as Vec3)
      : beforePosition;
    const afterRotation: Vec3 = propAfter
      ? ([propAfter.rotation[0], propAfter.rotation[1], propAfter.rotation[2]] as Vec3)
      : beforeRotation;
    const afterSnapshot = propAfter ? createSnapshotFromProp(propAfter) : beforeSnapshot;

    attachmentRecords.push({
      propId: prop.id,
      beforeSnapshot,
      afterSnapshot,
      beforeDocked: prop.docked,
      beforePosition,
      beforeRotation,
      beforeAttachment,
      beforeOffset,
      beforeState,
      afterDocked: propAfter?.docked ?? prop.docked,
      afterPosition,
      afterRotation,
      afterAttachment,
      afterOffset,
      afterState,
    });
  });

  if (needReconcile && propsToReconcile.size > 0) {
    scheduleDeskSurfaceReconcile(newDeskProp.id, Array.from(propsToReconcile));
  }

  deleteGenericProp(oldDesk.id);

  const newDesk = getGenericProp(newDeskProp.id);
  if (newDesk) {
    const newDeskSnapshot = createSnapshotFromProp(newDesk);
    useUndoHistoryStore.getState().push({
      type: 'desk-swap',
      oldDesk: oldDeskSnapshot,
      newDesk: newDeskSnapshot,
      attachments: attachmentRecords,
    });
  }

  setSelection({ kind: 'generic', id: newDeskProp.id });
  setState(() => ({
    active: false,
    targetDeskId: null,
    previewEntry: null,
    previewAnalysis: null,
  }));

  const snapshotAfterSwap = getGenericPropsSnapshot().map((prop) => ({
    id: prop.id,
    position: prop.position,
    docked: prop.docked,
    deskInstanceId: prop.dockAttachment?.deskInstanceId ?? null,
  }));
  console.info('[DeskSwap][post-swap-snapshot]', snapshotAfterSwap);

  if (typeof window !== 'undefined') {
    window.requestAnimationFrame(() => {
      const afterFrame = getGenericPropsSnapshot().map((prop) => ({
        id: prop.id,
        position: prop.position,
        docked: prop.docked,
        deskInstanceId: prop.dockAttachment?.deskInstanceId ?? null,
      }));
      console.info('[DeskSwap][post-frame-snapshot]', afterFrame);
    });
  }

  updateDeskSwapUndoSnapshots(newDeskProp.id);

  return true;
}

export const useDeskSwapStore = create<DeskSwapState>((set, get) => ({
  active: false,
  targetDeskId: null,
  previewEntry: null,
  previewAnalysis: null,
  pendingReview: null,
  pendingCompletion: null,
  cachedPreviews: {},
  previewRequestId: 0,

  begin: (deskId) => {
    set((state) => ({
      active: true,
      targetDeskId: deskId,
      previewEntry: null,
      previewAnalysis: null,
      pendingReview: null,
      pendingCompletion: null,
      previewRequestId: state.previewRequestId + 1,
    }));
  },

  cancel: () => {
    set((state) => ({
      active: false,
      targetDeskId: null,
      previewEntry: null,
      previewAnalysis: null,
      pendingReview: null,
      pendingCompletion: null,
      previewRequestId: state.previewRequestId + 1,
    }));
  },

  complete: (entry, options) => finalizeDeskSwapWithCached(entry, options, (fn) => set(fn), get),

  setPreviewEntry: (entry) => {
    const state = get();
    const { targetDeskId, active, previewRequestId } = state;
    if (!active || !targetDeskId) {
      set({
        previewEntry: null,
        previewAnalysis: null,
        pendingReview: null,
        previewRequestId: previewRequestId + 1,
      });
      return;
    }

    const nextRequestId = previewRequestId + 1;
    set({
      previewEntry: entry,
      previewAnalysis: null,
      pendingReview: null,
      previewRequestId: nextRequestId,
    });

    if (!entry) return;

    const deskProp = getGenericProp(targetDeskId);
    if (!deskProp) {
      return;
    }

    const oldCatalogEntry = deskProp.catalogId
      ? PROP_CATALOG.find((item) => item.id === deskProp.catalogId)
      : null;
    const oldDefaultScale = oldCatalogEntry?.defaultScale ?? 1;
    const newDefaultScale = entry.defaultScale ?? 1;
    const currentScale = deskProp.scale[0] ?? newDefaultScale;
    const userScaleMultiplier = oldDefaultScale > 0 ? currentScale / oldDefaultScale : 1;
    const previewScaleValue = newDefaultScale * userScaleMultiplier;
    const previewScale: Vec3 = [previewScaleValue, previewScaleValue, previewScaleValue];

    prefetchDeskSurfaces({
      entry,
      position: deskProp.position as Vec3,
      rotation: deskProp.rotation as Vec3,
      scale: previewScale,
    })
      .then((surfaces) => {
        const latest = get();
        if (
          latest.previewRequestId !== nextRequestId ||
          latest.previewEntry?.id !== entry.id ||
          latest.targetDeskId !== targetDeskId
        ) {
          return;
        }

        const surfaceMap: Record<string, SurfaceMeta | null> = {};
        surfaces.forEach((surface) => {
          surfaceMap[surface.baseSurfaceId] = surface.meta ?? null;
        });

        const propsSnapshot = getGenericPropsSnapshot();
        const currentDesk = getGenericProp(targetDeskId);
        if (!currentDesk) {
          return;
        }

        const attachments = computeAttachmentPreview(propsSnapshot, currentDesk, entry, surfaceMap);
        applyPreviewResult(entry.id, surfaceMap, attachments, true, (fn) => set(fn), get);
      })
      .catch((error) => {
        console.warn(`[DeskSwap] Prefetch surfaces for ${entry.id} failed`, error);
      });
  },

  setPreviewSurfaces: (catalogId, surfaces) => {
    const { previewEntry, targetDeskId, previewRequestId } = get();
    if (!previewEntry || previewEntry.id !== catalogId || !targetDeskId) {
      return;
    }

    const surfaceMap: Record<string, SurfaceMeta | null> = {};
    surfaces.forEach((surface) => {
      surfaceMap[surface.baseSurfaceId] = surface.meta ?? null;
    });

    const propsSnapshot = getGenericPropsSnapshot();
    const targetDesk = getGenericProp(targetDeskId);
    if (!targetDesk) {
      return;
    }

    const attachments = computeAttachmentPreview(propsSnapshot, targetDesk, previewEntry, surfaceMap);
    const latest = get();
    const applyToPreview = latest.previewEntry?.id === catalogId && latest.previewRequestId === previewRequestId;
    applyPreviewResult(catalogId, surfaceMap, attachments, applyToPreview, (fn) => set(fn), get);
  },

  clearPendingReview: () => {
    set({ pendingReview: null });
  },
}));

export function beginDeskSwap(deskId: string) {
  useDeskSwapStore.getState().begin(deskId);
}

export function cancelDeskSwap() {
  useDeskSwapStore.getState().cancel();
}

export function completeDeskSwap(entry: PropCatalogEntry): boolean {
  return useDeskSwapStore.getState().complete(entry);
}

export function forceCompleteDeskSwap(entry: PropCatalogEntry): boolean {
  return useDeskSwapStore.getState().complete(entry, { force: true });
}

export function clearDeskSwapReview() {
  useDeskSwapStore.getState().clearPendingReview();
}

export function setDeskSwapPreviewEntry(entry: PropCatalogEntry | null) {
  useDeskSwapStore.getState().setPreviewEntry(entry);
}

export function setDeskSwapPreviewSurfaces(catalogId: string, surfaces: DeskSwapPreviewSurface[]) {
  useDeskSwapStore.getState().setPreviewSurfaces(catalogId, surfaces);
}
