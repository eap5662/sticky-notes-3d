import { useEffect, useRef } from 'react';
import { useUndoToastStore } from '@/state/undoToastStore';

const TOAST_DURATION_MS = 3000;

export default function UndoToast() {
  const message = useUndoToastStore((s) => s.message);
  const isVisible = useUndoToastStore((s) => s.isVisible);
  const hide = useUndoToastStore((s) => s.hide);

  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isVisible) return;

    // Clear any existing timeout
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
    }

    // Set new timeout to hide toast
    timeoutRef.current = window.setTimeout(() => {
      hide();
    }, TOAST_DURATION_MS);

    return () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, [isVisible, hide]);

  if (!isVisible || !message) return null;

  return (
    <div className="pointer-events-none fixed left-1/2 top-8 z-50 -translate-x-1/2">
      <div className="animate-fade-in rounded-md bg-black/90 px-6 py-3 text-sm font-medium text-white shadow-lg border border-white/20">
        {message}
      </div>
    </div>
  );
}
