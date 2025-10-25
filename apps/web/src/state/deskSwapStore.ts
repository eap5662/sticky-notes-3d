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
  dockPropWithAttachment,
  dockPropWithOffset,
  setDockOffset,
  setDockAttachment,
  type DockAttachment,
  type DockOffset,
  type DockState,
  type GenericProp,
  type Vec3,
} from '@/state/genericPropsStore';
import { createSnapshotFromProp, useUndoHistoryStore, type DeskSwapAttachmentSnapshot } from '@/state/undoHistoryStore';
import { setSelection } from '@/state/selectionStore';
import type { SurfaceMeta } from '@/state/surfaceMetaStore';
import { clampUVToShape, projectPointToSurface } from '@/canvas/math/surfaceFrame';
import { createSurfaceId } from '@/canvas/surfaces';

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

type DeskSwapState = {
  active: boolean;
  targetDeskId: string | null;
  previewEntry: PropCatalogEntry | null;
  previewAnalysis: DeskSwapPreviewAnalysis | null;
  pendingReview: DeskSwapReviewContext | null;
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
  offsetUV: { u: number; v: number };
  lift: number;
  yawRel: number;
  clampApplied: boolean;
};

type AttachmentPlanOffset = {
  kind: 'offset';
  offset: DockOffset;
  clampApplied: boolean;
};

type AttachmentPlan = AttachmentPlanSurface | AttachmentPlanOffset;

function cloneAttachment(attachment: DockAttachment | undefined): DockAttachment | undefined {
  if (!attachment) return undefined;
  return {
    ...attachment,
    offsetUV: { ...attachment.offsetUV },
    surfaceSnapshot: attachment.surfaceSnapshot
      ? attachment.surfaceSnapshot.type === 'rect'
        ? { ...attachment.surfaceSnapshot }
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
          }
      : undefined,
  };
}

function cloneOffset(offset: DockOffset | undefined): DockOffset | undefined {
  if (!offset) return undefined;
  return { ...offset };
}

function getBaseSurfaceId(surfaceId: string | undefined): string | null {
  if (!surfaceId) return null;
  const parts = surfaceId.split(':');
  return parts[parts.length - 1] ?? null;
}

const CLAMP_EPSILON = 1e-4;

const UV_EPSILON = 1e-5;

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

function createSurfacePlan(
  baseSurfaceId: string,
  meta: SurfaceMeta,
  uv: { u: number; v: number },
  lift: number,
  yawRel: number,
): AttachmentPlanSurface {
  const clamped = clampUVToShape(meta, uv.u, uv.v);
  const delta = Math.abs(clamped.u - uv.u) + Math.abs(clamped.v - uv.v);
  return {
    kind: 'surface',
    baseSurfaceId,
    offsetUV: clamped,
    lift,
    yawRel,
    clampApplied: delta > CLAMP_EPSILON,
  };
}

function convertOffsetToUV(meta: SurfaceMeta, offset: DockOffset): { u: number; v: number } {
  const width = meta.extents.u;
  const depthSpan = meta.extents.v;
  const halfWidth = width / 2;
  const halfDepth = depthSpan / 2;
  const u = halfWidth > UV_EPSILON ? (offset.lateral / halfWidth + 1) * 0.5 : 0.5;
  const v = halfDepth > UV_EPSILON ? (offset.depth / halfDepth + 1) * 0.5 : 0.5;
  return { u, v };
}

function planAttachmentForProp(
  prop: GenericProp,
  surfaceMap: Record<string, SurfaceMeta | null>,
): { plan: AttachmentPlan | null; status: DeskSwapAttachmentPreviewStatus; reason?: string; notice?: 'repositioned' } {
  const attachment = prop.dockAttachment ?? null;
  const offset = prop.dockOffset ?? null;
  const propPosition = prop.position as Vec3;

  const yawRel = attachment?.yawRel ?? offset?.yaw ?? prop.rotation[1] ?? 0;

  if (attachment) {
    const baseSurfaceId = getBaseSurfaceId(String(attachment.surfaceId));
    if (baseSurfaceId) {
      const meta = surfaceMap[baseSurfaceId] ?? null;
      if (meta) {
        const projected = projectPointToSurface(meta, propPosition);
        const uv = projected ? { u: projected.u, v: projected.v } : attachment.offsetUV;
        const lift = projected ? projected.lift : attachment.lift;
        const plan = createSurfacePlan(baseSurfaceId, meta, uv, lift, yawRel);
        return {
          plan,
          status: plan.clampApplied ? 'clamped' : 'ok',
          reason: plan.clampApplied ? 'Attachment adjusted to fit new desk bounds' : undefined,
          notice: plan.clampApplied ? 'repositioned' : undefined,
        };
      }
    }
  }

  const primary = getPrimaryDeskSurface(surfaceMap);
  if (offset && primary?.meta) {
    const projected = projectPointToSurface(primary.meta, propPosition);
    const uv = projected ? { u: projected.u, v: projected.v } : convertOffsetToUV(primary.meta, offset);
    const lift = projected ? projected.lift : offset.lift;
    const plan = createSurfacePlan(primary.baseSurfaceId, primary.meta, uv, lift, yawRel);
    return {
      plan,
      status: plan.clampApplied ? 'clamped' : 'ok',
      reason: plan.clampApplied
        ? 'Placement adjusted to stay within new desk bounds'
        : undefined,
      notice: plan.clampApplied ? 'repositioned' : undefined,
    };
  }

  if (offset) {
    const planMeta = primary?.meta ?? null;
    const projected = planMeta ? projectPointToSurface(planMeta, propPosition) : null;
    if (projected && primary) {
      const plan = createSurfacePlan(primary.baseSurfaceId, primary.meta, { u: projected.u, v: projected.v }, projected.lift, yawRel);
      return {
        plan,
        status: plan.clampApplied ? 'clamped' : 'ok',
        reason: plan.clampApplied ? 'Placement adjusted to stay within new desk bounds' : undefined,
        notice: plan.clampApplied ? 'repositioned' : undefined,
      };
    }

    return {
      plan: {
        kind: 'offset',
        offset: { ...offset },
        clampApplied: false,
      },
      status: 'ok',
      reason: undefined,
      notice: undefined,
    };
  }

  return {
    plan: null,
    status: 'failed',
    reason: 'No attachment or offset data available',
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
    if (meta?.shape?.type === 'rect') {
      surfaceSnapshot = {
        type: 'rect' as const,
        width: meta.shape.width,
        height: meta.shape.height,
      };
    } else if (meta?.shape?.type === 'polygon') {
      surfaceSnapshot = {
        type: 'polygon' as const,
        points: meta.shape.points.map(([x, y]) => [x, y] as [number, number]),
      };
    }
    const attachment: DockAttachment = {
      deskInstanceId: newDeskId,
      surfaceId,
      offsetUV: { u: plan.offsetUV.u, v: plan.offsetUV.v },
      lift: plan.lift,
      yawRel: plan.yawRel,
      surfaceSnapshot,
    };
    const metaExtents = meta?.extents;
    const width = metaExtents?.u ?? 0;
    const depthSpan = metaExtents?.v ?? 0;
    const offset: DockOffset = {
      lateral: (plan.offsetUV.u - 0.5) * width,
      depth: (plan.offsetUV.v - 0.5) * depthSpan,
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

function computeAttachmentPreview(
  props: GenericProp[],
  targetDeskId: string,
  previewEntry: PropCatalogEntry | null,
  surfaceMap: Record<string, SurfaceMeta | null>,
): DeskSwapAttachmentPreview[] {
  if (!previewEntry) return [];

  const allowedSurfaces = new Set<string>(
    (previewEntry.surfaces ?? []).map((surface) => getBaseSurfaceId(String(surface.id))).filter(Boolean) as string[],
  );

  const hasSurfaceDefinitions = allowedSurfaces.size > 0;

  return props
    .filter((prop) => {
      if (prop.id === targetDeskId) return false;
      if (!prop.docked || prop.dockState !== 'attached') return false;
      if (!prop.dockAttachment && !prop.dockOffset) return false;
      if (prop.dockAttachment && prop.dockAttachment.deskInstanceId !== targetDeskId) return false;
      return true;
    })
    .map<DeskSwapAttachmentPreview>((prop) => {
      const label = prop.label ?? prop.catalogId ?? prop.id;

      let missingSurface = false;
      if (hasSurfaceDefinitions && prop.dockAttachment) {
        const baseSurfaceId = getBaseSurfaceId(String(prop.dockAttachment.surfaceId));
        if (baseSurfaceId && !allowedSurfaces.has(baseSurfaceId)) {
          missingSurface = true;
        }
      }

      const planned = planAttachmentForProp(prop, surfaceMap);
      if (missingSurface && planned.plan) {
        return {
          propId: prop.id,
          label,
          status: 'clamped',
          reason: planned.reason ?? 'Remapped to closest surface on new desk',
          notice: 'repositioned',
          plan: planned.plan,
        };
      }
      return {
        propId: prop.id,
        label,
        status: planned.status,
        reason: planned.reason ?? (missingSurface ? 'New desk lacks matching surface' : undefined),
        notice: planned.notice ?? (missingSurface ? 'repositioned' : undefined),
        plan: planned.plan,
      };
    });
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

function buildFallbackReview(
  props: GenericProp[],
  deskId: string,
  entry: PropCatalogEntry,
  reason: string,
): DeskSwapAttachmentPreview[] {
  const emptySurfaces: Record<string, SurfaceMeta | null> = {};
  return props
    .filter((prop) => {
      if (prop.id === deskId) return false;
      if (!prop.docked || prop.dockState !== 'attached') return false;
      if (prop.dockAttachment && prop.dockAttachment.deskInstanceId !== deskId) return false;
      return true;
    })
    .map((prop) => {
      const planned = planAttachmentForProp(prop, emptySurfaces);
      const label = prop.label ?? prop.catalogId ?? prop.id;
      if (planned.plan && planned.status !== 'failed') {
        return {
          propId: prop.id,
          label,
          status: planned.status,
          reason: planned.reason ?? reason,
          notice: planned.notice,
          plan: planned.plan,
        };
      }
      return {
        propId: prop.id,
        label,
        status: 'failed' as const,
        reason,
      };
    });
}

export const useDeskSwapStore = create<DeskSwapState>((set, get) => ({
  active: false,
  targetDeskId: null,
  previewEntry: null,
  previewAnalysis: null,
  pendingReview: null,

  begin: (deskId) => {
    set({ active: true, targetDeskId: deskId, previewEntry: null, previewAnalysis: null, pendingReview: null });
  },

  cancel: () => {
    set({ active: false, targetDeskId: null, previewEntry: null, previewAnalysis: null, pendingReview: null });
  },

  complete: (entry, options) => {
    const { active, targetDeskId } = get();
    if (!active || !targetDeskId) {
      return false;
    }

    const oldDesk = getGenericProp(targetDeskId);
    if (!oldDesk) {
      set({ active: false, targetDeskId: null, pendingReview: null });
      return false;
    }

    const preview = get().previewAnalysis;
    const propsSnapshot = getGenericPropsSnapshot();
    const surfaceMap = preview ? preview.surfaces : {};

    let attachments: DeskSwapAttachmentPreview[] | null = null;
    if (preview && preview.catalogId === entry.id) {
      attachments = computeAttachmentPreview(propsSnapshot, targetDeskId, entry, preview.surfaces);
    } else {
      attachments = buildFallbackReview(propsSnapshot, targetDeskId, entry, 'Swap preview unavailable');
    }

    const failedAttachments = attachments.filter((attachment) => attachment.status === 'failed');
    if (!options?.force && failedAttachments.length > 0) {
      set({ pendingReview: { entry, attachments } });
      return false;
    }

    if (!preview || preview.catalogId !== entry.id) {
      // Keep prior pending review context for force path
      set({ pendingReview: { entry, attachments } });
    }

    const oldDeskSnapshot = createSnapshotFromProp(oldDesk);

    const attachmentRecords: DeskSwapAttachmentSnapshot[] = [];

    const affectedProps = propsSnapshot.filter((prop) => {
      if (prop.id === oldDesk.id) return false;
      if (!prop.dockAttachment) return false;
      return prop.dockAttachment.deskInstanceId === oldDesk.id && prop.dockState === 'attached';
    });

    const oldCatalogEntry = oldDesk.catalogId
      ? PROP_CATALOG.find((item) => item.id === oldDesk.catalogId)
      : null;
    const oldDefaultScale = oldCatalogEntry?.defaultScale ?? 1;
    const newDefaultScale = entry.defaultScale ?? 1;
    const currentScale = oldDesk.scale[0] ?? newDefaultScale;
    const userScaleMultiplier =
      oldDefaultScale > 0 ? currentScale / oldDefaultScale : 1;
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

    affectedProps.forEach((prop) => {
      const beforeAttachment = cloneAttachment(prop.dockAttachment);
      const beforeOffset = cloneOffset(prop.dockOffset);
      const beforeState: DockState = prop.dockState;

      const previewInfo = attachments?.find((item) => item.propId === prop.id) ?? null;
      const planned = previewInfo?.plan ?? planAttachmentForProp(prop, surfaceMap).plan ?? null;
      let appliedAttachment: DockAttachment | undefined;
      let appliedOffset: DockOffset | undefined;

      if (planned) {
        const realized = realizeAttachmentPlan(planned, newDeskProp.id, surfaceMap);
        appliedAttachment = realized.attachment;
        appliedOffset = realized.offset;

        if (appliedAttachment) {
          dockPropWithAttachment(prop.id, appliedAttachment);
        }
        if (appliedOffset) {
          if (!appliedAttachment) {
            dockPropWithOffset(prop.id, appliedOffset);
            setDockAttachment(prop.id, undefined);
          }
          setDockOffset(prop.id, appliedOffset);
        }
      } else {
        const fallbackAttachment = remapAttachmentDeskId(beforeAttachment, newDeskProp.id);
        if (fallbackAttachment) {
          appliedAttachment = fallbackAttachment;
          dockPropWithAttachment(prop.id, fallbackAttachment);
        } else if (beforeOffset) {
          appliedOffset = beforeOffset;
          dockPropWithOffset(prop.id, beforeOffset);
          setDockAttachment(prop.id, undefined);
        }
      }

      const propAfter = getGenericProp(prop.id);
      const afterAttachment = cloneAttachment(propAfter?.dockAttachment);
      const afterOffset = cloneOffset(propAfter?.dockOffset);
      const afterState: DockState = propAfter?.dockState ?? 'attached';

      attachmentRecords.push({
        propId: prop.id,
        beforeDocked: prop.docked,
        beforeAttachment,
        beforeOffset,
        beforeState,
        afterDocked: true,
        afterAttachment,
        afterOffset,
        afterState,
      });
    });

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
    set({
      active: false,
      targetDeskId: null,
      previewEntry: null,
      previewAnalysis: null,
      pendingReview: null,
    });
    return true;
  },

  setPreviewEntry: (entry) => {
    const { targetDeskId, active } = get();
    if (!active || !targetDeskId) {
      set({ previewEntry: null, previewAnalysis: null, pendingReview: null });
      return;
    }
    set({ previewEntry: entry, previewAnalysis: null, pendingReview: null });
  },

  setPreviewSurfaces: (catalogId, surfaces) => {
    const { previewEntry, targetDeskId } = get();
    if (!previewEntry || previewEntry.id !== catalogId || !targetDeskId) {
      return;
    }

    const surfaceMap: Record<string, SurfaceMeta | null> = {};
    surfaces.forEach((surface) => {
      surfaceMap[surface.baseSurfaceId] = surface.meta ?? null;
    });

    const props = getGenericPropsSnapshot();
    const attachments = computeAttachmentPreview(props, targetDeskId, previewEntry, surfaceMap);

    set({
      previewAnalysis: {
        catalogId,
        surfaces: surfaceMap,
        attachments,
      },
      pendingReview: null,
    });
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
