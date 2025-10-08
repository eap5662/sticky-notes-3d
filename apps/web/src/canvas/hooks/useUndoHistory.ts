import { useEffect, useCallback } from 'react';
import { useUndoHistoryStore, type UndoAction } from '@/state/undoHistoryStore';
import { useUndoToastStore } from '@/state/undoToastStore';
import {
  spawnGenericProp,
  deleteGenericProp,
  setGenericPropPosition,
  setGenericPropRotation,
  setGenericPropUniformScale,
  dockPropWithOffset,
  undockProp,
} from '@/state/genericPropsStore';

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
      });

      // Restore scale, dock state after spawn
      setGenericPropUniformScale(restored.id, snapshot.scale[0]);
      if (snapshot.docked && snapshot.dockOffset) {
        dockPropWithOffset(restored.id, snapshot.dockOffset);
      }
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
      if (action.beforeDocked && action.dockOffset) {
        dockPropWithOffset(action.propId, action.dockOffset);
      } else {
        undockProp(action.propId);
      }
      setGenericPropPosition(action.propId, action.beforePos);
      break;
    }

    case 'undock': {
      // Undo undock = restore docked state
      if (action.beforeDocked && action.dockOffset) {
        dockPropWithOffset(action.propId, action.dockOffset);
      }
      setGenericPropPosition(action.propId, action.beforePos);
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
