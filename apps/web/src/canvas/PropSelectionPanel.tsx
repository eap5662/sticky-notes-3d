import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSelection } from '@/canvas/hooks/useSelection';
import { useDelayedVisibility } from '@/canvas/hooks/useDelayedVisibility';
import LayoutControls from '@/canvas/LayoutControls';
import PropScaleControls from '@/canvas/PropScaleControls';

export default function PropSelectionPanel() {
  const selection = useSelection();
  const selectedGenericId = selection && selection.kind === 'generic' ? selection.id : null;

  // Coordinate panel visibility with catalog/DELETE button animations
  const shouldShow = useDelayedVisibility(!!selectedGenericId, {
    enterDelay: 300, // Coordinate with catalog close
    exitDelay: 200   // Match exit animation duration
  });

  // Freeze selection ID during exit to keep children rendering
  // This prevents LayoutControls/PropScaleControls from returning null during exit animation
  const [frozenSelectionId, setFrozenSelectionId] = useState<string | null>(null);

  useEffect(() => {
    if (selectedGenericId !== null) {
      // Update frozen ID when selection changes
      setFrozenSelectionId(selectedGenericId);
    } else if (!shouldShow) {
      // Clear frozen ID only when fully invisible
      setFrozenSelectionId(null);
    }
    // Keep frozen ID during exit animation (selectedGenericId is null but shouldShow is still true)
  }, [selectedGenericId, shouldShow]);

  return (
    <AnimatePresence>
      {shouldShow && (
        <motion.div
          initial={{ opacity: 0, x: 20, scale: 0.95 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, x: 20, scale: 0.95 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="pointer-events-none flex flex-col items-end gap-2"
        >
          <LayoutControls overrideSelectionId={frozenSelectionId} />
          <PropScaleControls className="" overrideSelectionId={frozenSelectionId} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
