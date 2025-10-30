import { useEffect, useCallback } from 'react';
import { useUndoHistoryStore, type UndoAction, type GenericPropSnapshot } from '@/state/undoHistoryStore';
import { useUndoToastStore } from '@/state/undoToastStore';
import {
  spawnGenericProp,
  deleteGenericProp,
  setGenericPropPosition,
  setGenericPropRotation,
  setGenericPropUniformScale,
  setGenericPropStatus,
  setGenericPropLocked,
  dockPropWithOffset,
  dockPropWithAttachment,
  setDockAttachment,
  setDockState,
  undockProp,
  applySnapshotToProp,
  type DockAttachment,
} from '@/state/genericPropsStore';
import { setSelection } from '@/state/selectionStore';

function cloneAttachment(attachment: DockAttachment | undefined) {
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

function remapAttachmentDeskId(attachment: DockAttachment | undefined, nextDeskId: string) {
  const cloned = cloneAttachment(attachment);
  if (!cloned) return undefined;
  const prevDeskId = cloned.deskInstanceId;
  cloned.deskInstanceId = nextDeskId;
  const prefix = `${prevDeskId}:`;
  if (cloned.surfaceId?.startsWith(prefix)) {
    cloned.surfaceId = cloned.surfaceId.replace(prefix, `${nextDeskId}:`);
  }
  return cloned;
}

function remapSnapshotDeskId(snapshot: GenericPropSnapshot, nextDeskId: string): GenericPropSnapshot {
  if (!snapshot.dockAttachment) {
    return { ...snapshot };
  }
  const remappedAttachment = remapAttachmentDeskId(snapshot.dockAttachment, nextDeskId);
  return {
    ...snapshot,
    dockAttachment: remappedAttachment,
  };
}

function applyGenericSnapshot(snapshot: GenericPropSnapshot) {
  applySnapshotToProp(snapshot);
}

function getActionLabel(action: UndoAction): string {
  switch (action.type) {
    case 'spawn':
      return 'prop spawn';
    case 'delete':
      return 'prop deletion';
    case 'move':
      return 'movement';
    case 'rotate':
      return 'rotation';
    case 'scale':
      return 'scaling';
    case 'dock':
      return 'docking';
    case 'undock':
      return 'undocking';
    case 'desk-swap':
      return 'desk swap';
    default:
      return 'action';
  }
}

function executeUndo(action: UndoAction) {
  switch (action.type) {
    case 'spawn': {
      // Undo spawn = delete the prop
      deleteGenericProp(action.propId);
      break;
    }

    case 'delete': {
      // Undo delete = restore prop from snapshot
      const { snapshot } = action;
      const restored = spawnGenericProp({
        catalogId: snapshot.catalogId,
        label: snapshot.label,
        url: snapshot.url,
        anchor: snapshot.anchor,
        position: snapshot.position,
        rotation: snapshot.rotation,
        scale: snapshot.scale,
        locked: snapshot.locked,
      });

      applySnapshotToProp({ ...snapshot, id: restored.id });
      break;
    }

    case 'move': {
      // Undo move = restore previous position
      setGenericPropPosition(action.propId, action.before);
      break;
    }

    case 'rotate': {
      // Undo rotate = restore previous rotation
      setGenericPropRotation(action.propId, action.before);
      break;
    }

    case 'scale': {
      // Undo scale = restore previous scale
      setGenericPropUniformScale(action.propId, action.before[0]);
      break;
    }

    case 'dock': {
      // Undo dock = restore previous state
      if (action.beforeDocked) {
        if (action.dockAttachment) {
          dockPropWithAttachment(action.propId, action.dockAttachment);
        } else if (action.dockOffset) {
          dockPropWithOffset(action.propId, action.dockOffset);
        }
      } else {
        undockProp(action.propId);
        setDockAttachment(action.propId, undefined);
      }
      if (action.beforeState) {
        setDockState(action.propId, action.beforeState);
      }
      setGenericPropPosition(action.propId, action.beforePos);
      break;
    }

    case 'undock': {
      // Undo undock = restore docked state
      if (action.beforeDocked) {
        if (action.dockAttachment) {
          dockPropWithAttachment(action.propId, action.dockAttachment);
        } else if (action.dockOffset) {
          dockPropWithOffset(action.propId, action.dockOffset);
        }
      }
      if (action.beforeState) {
        setDockState(action.propId, action.beforeState);
      }
      setGenericPropPosition(action.propId, action.beforePos);
      break;
    }

    case 'desk-swap': {
      const { oldDesk, newDesk, attachments } = action;

      deleteGenericProp(newDesk.id);

      const restoredDesk = spawnGenericProp({
        catalogId: oldDesk.catalogId,
        label: oldDesk.label,
        url: oldDesk.url,
        anchor: oldDesk.anchor,
        position: oldDesk.position,
        rotation: oldDesk.rotation,
        scale: oldDesk.scale,
        locked: oldDesk.locked,
      });
      setGenericPropStatus(restoredDesk.id, 'placed');
      setGenericPropUniformScale(restoredDesk.id, oldDesk.scale[0]);
      setGenericPropLocked(restoredDesk.id, oldDesk.locked);

      attachments.forEach((record) => {
        const remapped = remapSnapshotDeskId(record.beforeSnapshot, restoredDesk.id);
        applyGenericSnapshot(remapped);
      });

      setSelection({ kind: 'generic', id: restoredDesk.id });
      break;
    }
  }
}

export function useUndoHistory() {
  const undo = useUndoHistoryStore((s) => s.undo);
  const showToast = useUndoToastStore((s) => s.show);

  const handleUndo = useCallback(() => {
    const action = undo();
    if (!action) return;

    executeUndo(action);

    const label = getActionLabel(action);
    showToast(`Undid ${label}`);
  }, [undo, showToast]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // Ctrl+Z (both must be held)
      if (event.ctrlKey && event.key === 'z') {
        event.preventDefault();
        handleUndo();
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleUndo]);
}
