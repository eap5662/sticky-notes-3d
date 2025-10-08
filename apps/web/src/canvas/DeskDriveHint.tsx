import { useEffect, useRef, useState } from 'react';

import { useSelection } from '@/canvas/hooks/useSelection';
import { useGenericProp } from '@/canvas/hooks/useGenericProps';

const DISPLAY_DURATION_MS = 3500;

export default function DeskDriveHint() {
  const selection = useSelection();
  const selectedGenericId = selection?.kind === 'generic' ? selection.id : null;
  const selectedProp = useGenericProp(selectedGenericId);

  const isDeskSelected = selectedProp?.catalogId === 'desk-default';
  const isDraggingDesk = isDeskSelected && selectedProp?.status === 'dragging';

  const [visible, setVisible] = useState(false);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    if (isDraggingDesk) {
      setVisible(true);
      timeoutRef.current = window.setTimeout(() => setVisible(false), DISPLAY_DURATION_MS);
    } else if (!isDeskSelected) {
      setVisible(false);
    }

    return () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [isDeskSelected, isDraggingDesk]);

  if (!visible) return null;

  return (
    <div className="pointer-events-none absolute left-1/2 top-6 z-30 -translate-x-1/2 rounded-md bg-black/75 px-3 py-1.5 text-xs text-white/80 shadow-lg">
      Desk drive active — move cursor away to push (or use WASD); return to center to stop
    </div>
  );
}
