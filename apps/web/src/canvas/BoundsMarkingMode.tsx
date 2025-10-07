import { useEffect, useState, useCallback, useRef } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { useSelection } from '@/canvas/hooks/useSelection';
import { useGenericProp } from '@/canvas/hooks/useGenericProps';
import { useSurface, useSurfacesByKind } from '@/canvas/hooks/useSurfaces';
import { planeProject } from '@/canvas/math/plane';
import { setDeskBounds, clearDeskBounds, setMarkingMode, type Vec2 } from '@/state/deskBoundsStore';

const MARKER_COLOR = '#fbbf24'; // Yellow
const LINE_COLOR = '#fbbf24'; // Yellow

export default function BoundsMarkingMode() {
  const [isActive, setIsActive] = useState(false);
  const [points, setPoints] = useState<Vec2[]>([]);
  const pointsRef = useRef<Vec2[]>([]);

  const selection = useSelection();
  const selectedGenericId = selection && selection.kind === 'generic' ? selection.id : null;
  const selectedProp = useGenericProp(selectedGenericId);

  // Only activate for desk props
  const isDesk = selectedProp?.catalogId === 'desk-default';

  const deskSurfaces = useSurfacesByKind('desk');
  const deskSurfaceId = deskSurfaces[0]?.id;
  const deskSurface = useSurface(deskSurfaceId ?? '');

  const { camera, gl } = useThree();

  // Keyboard listener for Shift + B activation
  useEffect(() => {
    if (!isDesk || !selectedProp) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.shiftKey && event.key.toLowerCase() === 'b') {
        event.preventDefault();
        setIsActive(true);
        setMarkingMode(true);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isDesk, selectedProp]);

  // Keyboard listener for Enter/Escape while active
  useEffect(() => {
    if (!isActive) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Enter') {
        // Finalize bounds
        if (pointsRef.current.length >= 3 && selectedProp) {
          setDeskBounds(selectedProp.id, pointsRef.current);
          console.log(`[BoundsMarkingMode] Saved ${pointsRef.current.length} points for desk ${selectedProp.id}`);
        }
        setIsActive(false);
        setMarkingMode(false);
        setPoints([]);
        pointsRef.current = [];
      } else if (event.key === 'Escape') {
        // Cancel
        setIsActive(false);
        setMarkingMode(false);
        setPoints([]);
        pointsRef.current = [];
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isActive, selectedProp]);

  // Click listener for adding points
  useEffect(() => {
    if (!isActive || !deskSurface) return;

    function onClick(event: MouseEvent) {
      // Calculate mouse position in normalized device coordinates
      const canvas = gl.domElement;
      const rect = canvas.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      // Raycast from camera through mouse position
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(new THREE.Vector2(x, y), camera);

      // Project onto desk surface
      if (!deskSurface) return;
      const hit = planeProject(raycaster.ray, deskSurface);
      if (hit.hit) {
        const newPoint: Vec2 = [hit.point.x, hit.point.z];
        const newPoints = [...pointsRef.current, newPoint];
        pointsRef.current = newPoints;
        setPoints(newPoints);
        console.log(`[BoundsMarkingMode] Added point: [${newPoint[0].toFixed(3)}, ${newPoint[1].toFixed(3)}]`);
      }
    }

    window.addEventListener('click', onClick);
    return () => window.removeEventListener('click', onClick);
  }, [isActive, deskSurface, camera, gl]);

  if (!isActive) return null;

  // Get desk height for rendering markers
  const deskY = deskSurface?.origin[1] ?? 0;

  return (
    <>
      {/* Instructions overlay */}
      <group>
        {/* Render point markers */}
        {points.map((point, index) => (
          <mesh key={index} position={[point[0], deskY + 0.01, point[1]]}>
            <circleGeometry args={[0.02, 16]} />
            <meshBasicMaterial color={MARKER_COLOR} side={THREE.DoubleSide} />
          </mesh>
        ))}

        {/* Render connecting lines */}
        {points.length > 1 && (() => {
          const positions = new Float32Array(points.flatMap(p => [p[0], deskY + 0.01, p[1]]));
          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
          return (
            <lineSegments geometry={geometry}>
              <lineBasicMaterial color={LINE_COLOR} linewidth={2} />
            </lineSegments>
          );
        })()}

        {/* Closing line (connect last to first) */}
        {points.length >= 3 && (() => {
          const positions = new Float32Array([
            points[points.length - 1][0], deskY + 0.01, points[points.length - 1][1],
            points[0][0], deskY + 0.01, points[0][1],
          ]);
          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
          return (
            <lineSegments geometry={geometry}>
              <lineBasicMaterial color={LINE_COLOR} linewidth={2} opacity={0.5} transparent />
            </lineSegments>
          );
        })()}
      </group>
    </>
  );
}

// Instructions overlay (rendered outside Canvas in SceneRoot)
export function BoundsMarkingInstructions({ isActive }: { isActive: boolean }) {
  if (!isActive) return null;

  return (
    <div className="pointer-events-none absolute left-1/2 top-20 z-50 -translate-x-1/2">
      <div className="rounded-md bg-yellow-500/90 px-6 py-3 text-sm font-medium text-black shadow-lg">
        Click corners to define desk bounds • <kbd className="rounded bg-black/20 px-2 py-0.5 text-xs">Enter</kbd> to finish • <kbd className="rounded bg-black/20 px-2 py-0.5 text-xs">Esc</kbd> to cancel
        <div className="mt-1 text-xs opacity-75">
          {/* Point count will be shown here */}
        </div>
      </div>
    </div>
  );
}
