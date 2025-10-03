import { useCallback } from 'react';

import { useGenericProp } from '@/canvas/hooks/useGenericProps';
import { useSelection } from '@/canvas/hooks/useSelection';
import { setGenericPropStatus } from '@/state/genericPropsStore';

export default function GenericPropScaleBanner() {
  const selection = useSelection();
  const selectedId = selection && selection.kind === 'generic' ? selection.id : null;
  const prop = useGenericProp(selectedId);

  const handleDone = useCallback(() => {
    if (!prop) return;
    setGenericPropStatus(prop.id, 'dragging');
  }, [prop]);

  if (!prop || prop.status !== 'editing') {
    return null;
  }

  return (
    <div className="pointer-events-none absolute left-1/2 bottom-6 z-20 -translate-x-1/2">
      <div className="pointer-events-auto flex items-center gap-3 rounded-full bg-black/70 px-4 py-2 text-[11px] uppercase tracking-wide text-white shadow">
        <span>Editing scale - Press Done to finish</span>
        <button
          type="button"
          className="rounded-full bg-white/20 px-3 py-1 text-[10px] uppercase tracking-wide hover:bg-white/30"
          onClick={handleDone}
        >
          Done
        </button>
      </div>
    </div>
  );
}
