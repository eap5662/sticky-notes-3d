import { useCallback } from 'react';
import { useCamera } from '@/state/cameraSlice';
import { useSurfacesByKind } from '@/canvas/hooks/useSurfaces';

export default function CameraModeToggle() {
  const mode = useCamera((s) => s.mode);
  const setMode = useCamera((s) => s.setMode);

  // Check if screen/monitor exists
  const screenSurfaces = useSurfacesByKind('screen');
  const hasMonitor = screenSurfaces.length > 0;
  const screenSurfaceId = screenSurfaces[0]?.id;

  const handleToggle = useCallback(() => {
    if (!hasMonitor) return;

    if (mode.kind === 'desk') {
      setMode({ kind: 'screen', surfaceId: screenSurfaceId });
    } else {
      setMode({ kind: 'desk' });
    }
  }, [mode, hasMonitor, screenSurfaceId, setMode]);

  const isDeskMode = mode.kind === 'desk';
  const label = isDeskMode ? 'View: Desk' : 'View: Screen';

  return (
    <button
      type="button"
      className={`pointer-events-auto w-fit rounded-full px-3 py-1 text-xs uppercase tracking-wide text-white shadow ${
        hasMonitor
          ? 'bg-black/70 hover:bg-black/80'
          : 'bg-black/40 cursor-not-allowed opacity-50'
      }`}
      onClick={hasMonitor ? handleToggle : undefined}
      disabled={!hasMonitor}
    >
      {label}
    </button>
  );
}
