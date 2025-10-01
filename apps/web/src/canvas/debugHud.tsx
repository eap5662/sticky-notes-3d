"use client";
/**
 * DebugHud
 * --------
 * Simple on-screen overlay that shows camera mode + pose
 * plus key surface readouts for quick validation.
 */
import { useCamera } from '@/state/cameraSlice';
import { useSurface, useSurfaceMeta } from '@/canvas/hooks/useSurfaces';
import { useLayoutFrameState } from '@/canvas/hooks/useLayoutFrame';

function radToDeg(r: number) {
  return (r * 180) / Math.PI;
}

function formatVec3(vec: [number, number, number] | null) {
  if (!vec) return 'n/a';
  return `${vec[0].toFixed(2)}, ${vec[1].toFixed(2)}, ${vec[2].toFixed(2)}`;
}

export default function DebugHud() {
  const mode = useCamera((s) => s.mode);
  const yaw = useCamera((s) => s.yaw);
  const pitch = useCamera((s) => s.pitch);
  const dolly = useCamera((s) => s.dolly);

  const deskMeta = useSurfaceMeta('desk');
  const monitorMeta = useSurfaceMeta('monitor1');

  const deskSurface = useSurface('desk');
  const monitorSurface = useSurface('monitor1');

  const layout = useLayoutFrameState();

  const formatSize = (extents?: { u: number; v: number }) =>
    extents ? `${extents.u.toFixed(3)} x ${extents.v.toFixed(3)}` : 'n/a';

  return (
    <div
      className="pointer-events-none absolute left-3 top-3 z-50 rounded-md bg-black/70 px-3 py-2 text-xs text-white shadow-md"
      style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}
    >
      <div className="opacity-75">Sticky Notes 3D :: Debug</div>
      <div>
        mode: <span className="font-semibold">{mode.kind}</span>
      </div>
      {mode.kind === 'screen' && (
        <div className="ml-4">
          surfaceId: <span className="font-semibold">{mode.surfaceId}</span>
        </div>
      )}
      <div>
        yaw: <span className="font-semibold">{radToDeg(yaw).toFixed(1)} deg</span>
      </div>
      <div>
        pitch: <span className="font-semibold">{radToDeg(pitch).toFixed(1)} deg</span>
      </div>
      <div>
        dolly: <span className="font-semibold">{dolly.toFixed(2)}</span>
      </div>

      <div className="mt-2 border-t border-white/20 pt-2">
        <div className="opacity-75">Layout Frame</div>
        <div>
          status: <span className="font-semibold">{layout.status}</span>
        </div>
        <div>
          target: <span className="font-semibold">{formatVec3(layout.cameraTarget)}</span>
        </div>
        <div>
          monitor pos: <span className="font-semibold">{formatVec3(layout.monitorPlacement?.position ?? null)}</span>
        </div>
      </div>

      <div className="mt-2 border-t border-white/20 pt-2">
        <div className="opacity-75">Surfaces</div>
        <div>
          desk top y: <span className="font-semibold">{deskSurface ? deskSurface.origin[1].toFixed(3) : 'n/a'}</span>
        </div>
        <div>
          desk center y: <span className="font-semibold">{deskMeta ? deskMeta.center[1].toFixed(3) : 'n/a'}</span>
        </div>
        <div>
          monitor center y: <span className="font-semibold">{monitorMeta ? monitorMeta.center[1].toFixed(3) : 'n/a'}</span>
        </div>
        <div>
          desk size: <span className="font-semibold">{formatSize(deskMeta?.extents)}</span>
        </div>
        <div>
          screen size: <span className="font-semibold">{formatSize(monitorMeta?.extents)}</span>
        </div>
        <div>
          monitor surface y: <span className="font-semibold">{monitorSurface ? monitorSurface.origin[1].toFixed(3) : 'n/a'}</span>
        </div>
      </div>

      <div className="mt-2 opacity-70">
        drag = orbit ; wheel = zoom ; click monitor = screen ; Esc = desk
      </div>
    </div>
  );
}
