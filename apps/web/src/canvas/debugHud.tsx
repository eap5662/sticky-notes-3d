"use client";
/**
 * DebugHud
 * --------
 * Simple on-screen overlay that shows camera mode + pose (yaw/pitch/dolly).
 * Beginner notes:
 * - This is a normal React component rendering regular HTML (not 3D).
 * - It subscribes to the Zustand store to read current values.
 * - We convert radians -> degrees for readability.
 */
import { useCamera } from "@/state/cameraSlice";

function radToDeg(r: number) {
  return (r * 180) / Math.PI;
}

export default function DebugHud() {
  const mode = useCamera((s) => s.mode);
  const yaw = useCamera((s) => s.yaw);
  const pitch = useCamera((s) => s.pitch);
  const dolly = useCamera((s) => s.dolly);

  return (
    <div
      // Tailwind styles for a small unobtrusive overlay
      className="pointer-events-none absolute left-3 top-3 z-50 rounded-md bg-black/60 px-3 py-2 text-xs text-white shadow-md"
      style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}
    >
      <div className="opacity-75">Sticky Notes 3D — Debug</div>
      <div>mode: <span className="font-semibold">{mode.kind}</span></div>
      {mode.kind === "screen" && (
        <div className="ml-4">surfaceId: <span className="font-semibold">{mode.surfaceId}</span></div>
      )}
      <div>yaw: <span className="font-semibold">{radToDeg(yaw).toFixed(1)}°</span></div>
      <div>pitch: <span className="font-semibold">{radToDeg(pitch).toFixed(1)}°</span></div>
      <div>dolly: <span className="font-semibold">{dolly.toFixed(2)}</span></div>
      <div className="mt-1 opacity-70">
        drag = orbit &nbsp;•&nbsp; wheel = zoom &nbsp;•&nbsp; click monitor = screen &nbsp;•&nbsp; Esc = desk
      </div>
    </div>
  );
}
