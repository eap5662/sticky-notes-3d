import { useCallback } from 'react';
import { useSelection } from '@/canvas/hooks/useSelection';
import { useGenericProp } from '@/canvas/hooks/useGenericProps';
import { deleteGenericProp } from '@/state/genericPropsStore';
import { useCamera } from '@/state/cameraSlice';
import { useUndoHistoryStore, type GenericPropSnapshot } from '@/state/undoHistoryStore';

export default function DeletePropButton() {
  const selection = useSelection();
  const selectedGenericId = selection && selection.kind === 'generic' ? selection.id : null;
  const selectedGeneric = useGenericProp(selectedGenericId);

  const setMode = useCamera((s) => s.setMode);
  const cameraMode = useCamera((s) => s.mode);
  const pushAction = useUndoHistoryStore((s) => s.push);

  const handleDelete = useCallback(() => {
    if (!selectedGeneric) return;

    // Capture snapshot for undo
    const snapshot: GenericPropSnapshot = {
      id: selectedGeneric.id,
      catalogId: selectedGeneric.catalogId ?? '',
      label: selectedGeneric.label,
      url: selectedGeneric.url,
      anchor: selectedGeneric.anchor,
      position: selectedGeneric.position,
      rotation: selectedGeneric.rotation,
      scale: selectedGeneric.scale,
      docked: selectedGeneric.docked,
      dockOffset: selectedGeneric.dockOffset,
    };

    // Push delete action to undo stack
    pushAction({
      type: 'delete',
      propId: selectedGeneric.id,
      snapshot,
    });

    // If deleting monitor while in screen mode, switch back to wide view
    const isMonitor = selectedGeneric.catalogId === 'monitor-basic';
    if (isMonitor && cameraMode.kind === 'screen') {
      setMode({ kind: 'wide' });
    }

    // Delete the prop (surfaces auto-cleanup via GLTFProp unmount)
    deleteGenericProp(selectedGeneric.id);
  }, [selectedGeneric, cameraMode, setMode, pushAction]);

  if (!selectedGeneric) return null;

  // Prevent desk deletion for now
  const isDesk = selectedGeneric.catalogId === 'desk-default';
  const buttonClass = isDesk
    ? 'pointer-events-auto rounded border border-red-600/30 bg-red-600/20 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-red-400/50 cursor-not-allowed'
    : 'pointer-events-auto rounded border border-red-600/70 bg-red-600/70 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-white hover:bg-red-600/90 transition-colors';

  return (
    <button
      type="button"
      className={buttonClass}
      onClick={isDesk ? undefined : handleDelete}
      disabled={isDesk}
    >
      Delete Prop
    </button>
  );
}
