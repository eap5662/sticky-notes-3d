import { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSelection } from '@/canvas/hooks/useSelection';
import LayoutControls from '@/canvas/LayoutControls';
import PropScaleControls from '@/canvas/PropScaleControls';

export default function PropSelectionPanel() {
  const selection = useSelection();
  const selectedGenericId = selection && selection.kind === 'generic' ? selection.id : null;

  // Track delayed showing to coordinate with catalog close animation
  const [shouldShow, setShouldShow] = useState(false);
  const prevSelectionIdRef = useRef<string | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Coordinate showing/hiding with catalog transitions
  useEffect(() => {
    // Clear any pending timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    const hadSelection = prevSelectionIdRef.current !== null;
    const hasSelection = selectedGenericId !== null;

    if (!hadSelection && hasSelection) {
      // New selection (was null, now has value) - delay to let catalog close
      // First hide immediately, then show after delay
      setShouldShow(false);
      timeoutRef.current = setTimeout(() => {
        setShouldShow(true);
        timeoutRef.current = null;
      }, 300);
    } else if (hadSelection && hasSelection) {
      // Selection changed (different prop selected) - show immediately
      setShouldShow(true);
    } else {
      // No selection - hide immediately (exit animation)
      setShouldShow(false);
    }

    prevSelectionIdRef.current = selectedGenericId;

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [selectedGenericId]);

  return (
    <AnimatePresence>
      {shouldShow && selectedGenericId && (
        <motion.div
          initial={{ opacity: 0, x: 20, scale: 0.95 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, x: 20, scale: 0.95 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          className="pointer-events-none flex flex-col items-end gap-2"
        >
          <LayoutControls />
          <PropScaleControls className="" />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
