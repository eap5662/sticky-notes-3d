import { useEffect, useState, useRef } from 'react';

type DelayedVisibilityOptions = {
  /** Delay before showing when condition becomes true (default: 300ms) */
  enterDelay?: number;
  /** Delay before hiding when condition becomes false (default: 200ms) */
  exitDelay?: number;
};

/**
 * Coordinates visibility transitions with configurable delays.
 * Used to synchronize UI element animations (e.g., panels appearing/disappearing).
 *
 * This hook prevents animation conflicts by:
 * - Delaying entrance to let other UI elements finish exiting (catalog close)
 * - Delaying exit to allow AnimatePresence exit animations to complete
 *
 * @param shouldBeVisible - Current visibility condition
 * @param options - Timing configuration
 * @returns Whether the component should currently be visible
 *
 * @example
 * ```tsx
 * const isVisible = useDelayedVisibility(!!selectedProp, {
 *   enterDelay: 300, // Wait for catalog to close
 *   exitDelay: 200   // Match exit animation duration
 * });
 *
 * return (
 *   <AnimatePresence>
 *     {isVisible && (
 *       <motion.div
 *         initial={{ opacity: 0 }}
 *         animate={{ opacity: 1 }}
 *         exit={{ opacity: 0 }}
 *         transition={{ duration: 0.2 }}
 *       >
 *         Content
 *       </motion.div>
 *     )}
 *   </AnimatePresence>
 * );
 * ```
 */
export function useDelayedVisibility(
  shouldBeVisible: boolean,
  options: DelayedVisibilityOptions = {}
): boolean {
  const { enterDelay = 300, exitDelay = 200 } = options;
  const [isVisible, setIsVisible] = useState(false);
  const prevVisibilityRef = useRef(shouldBeVisible);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Clear any pending timeout
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    const wasVisible = prevVisibilityRef.current;
    const shouldShow = shouldBeVisible;

    if (!wasVisible && shouldShow) {
      // Entering: delay to coordinate with other closing animations
      setIsVisible(false);
      timeoutRef.current = setTimeout(() => {
        setIsVisible(true);
        timeoutRef.current = null;
      }, enterDelay);
    } else if (wasVisible && shouldShow) {
      // Still visible: show immediately (selection changed)
      setIsVisible(true);
    } else if (wasVisible && !shouldShow) {
      // Exiting: delay to allow exit animation to complete
      timeoutRef.current = setTimeout(() => {
        setIsVisible(false);
        timeoutRef.current = null;
      }, exitDelay);
    } else {
      // Not visible
      setIsVisible(false);
    }

    prevVisibilityRef.current = shouldShow;

    // Cleanup on unmount or dependency change
    return () => {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [shouldBeVisible, enterDelay, exitDelay]);

  return isVisible;
}
