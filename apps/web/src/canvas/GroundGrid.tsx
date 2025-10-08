import { useMemo } from 'react';
import * as THREE from 'three';

const GRID_SIZE_METERS = 6; // total width/length of grid
const MINOR_STEP_METERS = 0.25; // 25 cm increments
const MAJOR_STEP_METERS = 1; // 1 m increments
const BASE_COLOR = '#0b0d12';
const MINOR_COLOR = '#1f2937';
const MAJOR_COLOR = '#22d3ee';

export default function GroundGrid() {
  const { minorDivisions, majorDivisions } = useMemo(() => {
    const minor = Math.max(1, Math.round(GRID_SIZE_METERS / MINOR_STEP_METERS));
    const major = Math.max(1, Math.round(GRID_SIZE_METERS / MAJOR_STEP_METERS));
    return { minorDivisions: minor, majorDivisions: major };
  }, []);

  return (
    <group>
      {/* Subtle base plane to catch light and reflections */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.0005, 0]}
        receiveShadow
        raycast={() => null}
      >
        <planeGeometry args={[GRID_SIZE_METERS, GRID_SIZE_METERS]} />
        <meshStandardMaterial color={BASE_COLOR} roughness={0.95} metalness={0} />
      </mesh>

      {/* Fine grid for minor increments */}
      <gridHelper
        args={[GRID_SIZE_METERS, minorDivisions, MINOR_COLOR, MINOR_COLOR]}
        position={[0, 0, 0]}
        raycast={() => null}
      />

      {/* Brighter overlay for major increments */}
      <gridHelper
        args={[GRID_SIZE_METERS, majorDivisions, MAJOR_COLOR, MAJOR_COLOR]}
        position={[0, 0.001, 0]}
        raycast={() => null}
      />
    </group>
  );
}
