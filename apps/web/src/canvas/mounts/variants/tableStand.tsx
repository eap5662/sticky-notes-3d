// apps/web/src/canvas/mounts/variants/tableStand.tsx
import * as React from 'react';
import * as THREE from 'three';
import { useMemo, useEffect } from 'react';
import type { PoseOutputs, TableStandConfig, VerifySummary } from '../types';
import { verifyAndAdjustTableStand } from '../verifier';

type Props = {
  pose: PoseOutputs;
  config: TableStandConfig;
  showDebug?: boolean;
  onVerify?: (s: VerifySummary) => void;
};

export function TableStandMount({ pose, config, showDebug = false, onVerify }: Props) {
  const { transforms, summary } = useMemo(() => verifyAndAdjustTableStand(pose, config), [pose, config]);

  useEffect(() => {
    onVerify?.(summary);
  }, [summary, onVerify]);

  // Simple status-driven colors
  const baseColor = summary.baseOk ? (summary.adjusted ? 'orange' : 'green') : 'red';
  const neckColor = summary.axisDeg <= 8 ? 'green' : 'red';
  const plateColor = 'silver';

  // Helper to mount a unit box under a world pose (position/quaternion/scale)
  const Part: React.FC<{ pose: THREE.Object3D; color: string }> = ({ pose, color }) => (
    <group position={pose.position} quaternion={pose.quaternion} scale={pose.scale}>
      <mesh>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial roughness={0.6} metalness={0.0} color={color} />
      </mesh>
    </group>
  );

  return (
    <group>
      <Part pose={transforms.basePose} color={baseColor} />
      <Part pose={transforms.neckPose} color={neckColor} />
      <Part pose={transforms.platePose} color={plateColor} />

      {showDebug && (
        <group>
          {/* Socket point marker */}
          <mesh position={pose.P_sock}>
            <sphereGeometry args={[0.007, 12, 12]} />
            <meshBasicMaterial color="magenta" />
          </mesh>
          {/* Base top → socket line */}
          <mesh>
            <lineSegments>
              <bufferGeometry
                attach="geometry"
                onUpdate={(g: THREE.BufferGeometry) => g.computeBoundingSphere()}
              >
                <bufferAttribute
                  attach="attributes-position"
                  args={[
                    new Float32Array([
                      transforms.basePose.position.x,
                      transforms.basePose.position.y + config.base.t / 2,
                      transforms.basePose.position.z,
                      pose.P_sock.x,
                      pose.P_sock.y,
                      pose.P_sock.z,
                    ]),
                    3,
                  ]}
                />
              </bufferGeometry>
              <lineBasicMaterial linewidth={1} color={neckColor} />
            </lineSegments>
          </mesh>
        </group>
      )}
    </group>
  );
}
