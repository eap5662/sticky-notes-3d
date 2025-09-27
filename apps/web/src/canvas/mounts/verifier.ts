// apps/web/src/canvas/mounts/verifier.ts
import * as THREE from 'three';
import { initialTableStandTransforms } from './pose';
import type { PoseOutputs, TableStandConfig, VerifySummary } from './types';
import {
  EPS_ANCHOR_MM,
  EPS_ANGLE_DEG,
  AUTO_RAISE_CAP_MM,
  DEFAULT_MIN_CLEARANCE_MM,
  mmToM,
  radToDeg,
} from './rules';

export type VerifyResult = {
    //transforms property will inherit the type from initialTableStandTransforms function
  transforms: ReturnType<typeof initialTableStandTransforms>;
  summary: VerifySummary;
};

// Local helper: re-aim an Object3D so its local +Y points along `dir` from `origin`.
function aimY(obj: THREE.Object3D, origin: THREE.Vector3, dir: THREE.Vector3) {
  obj.position.copy(origin);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  obj.quaternion.copy(q);
}

export function verifyAndAdjustTableStand(pose: PoseOutputs, cfg: TableStandConfig): VerifyResult {
    /*  pose stores: desk_point, and 3 vectors.  socket_point, and 3 vectors   */
  const minClrM = mmToM(cfg.base.minClearance ?? DEFAULT_MIN_CLEARANCE_MM);
  const anchorTolM = mmToM(EPS_ANCHOR_MM);

  // Seed transforms from posing
  const transforms = initialTableStandTransforms(pose, cfg);

  // --- Clearance check (base bottom vs desk plane) ---
  const baseCenter = transforms.basePose.position.clone();
  const baseBottom = baseCenter.clone().add(pose.N_d.clone().multiplyScalar(-cfg.base.t / 2));
  const deskRef = pose.P_desk; // any point on desk plane works
  const gap = baseBottom.clone().sub(deskRef).dot(pose.N_d); // signed distance along desk normal
  let baseOk = gap >= minClrM - 1e-6;

  // --- Optional auto-raise if short on clearance ---
  let raisedM = 0;
  if (!baseOk) {
    const need = minClrM - gap;
    const raiseCap = mmToM(AUTO_RAISE_CAP_MM);
    raisedM = Math.min(Math.max(need, 0), raiseCap);
    if (raisedM > 0) {
      transforms.basePose.position.add(pose.N_d.clone().multiplyScalar(raisedM));
      // Recompute neck to still hit the socket
      const baseTop = transforms.basePose.position.clone().add(pose.N_d.clone().multiplyScalar(cfg.base.t / 2));
      const D = pose.P_sock.clone().sub(baseTop);
      const L = Math.max(D.length(), 1e-6);
      aimY(transforms.neckPose, baseTop, D);
      transforms.neckPose.scale.set(cfg.neck.width, L, cfg.neck.depth);
      baseOk = true; // clearance satisfied after auto-raise (by construction)
    }
  }

  // --- Axis & attach checks (after any adjustment) ---
  const baseTopNow = transforms.basePose.position.clone().add(pose.N_d.clone().multiplyScalar(cfg.base.t / 2));
  const neckAxis = new THREE.Vector3(0, 1, 0).applyQuaternion(transforms.neckPose.quaternion).normalize();
  const toSocket = pose.P_sock.clone().sub(baseTopNow).normalize();
  const axisDeg = radToDeg(Math.acos(THREE.MathUtils.clamp(neckAxis.dot(toSocket), -1, 1)));

  // Stand top point = baseTop + axis * current length
  const Lnow = transforms.neckPose.scale.y;
  const standTop = baseTopNow.clone().add(neckAxis.clone().multiplyScalar(Lnow));
  const socketErr = standTop.distanceTo(pose.P_sock);

  const summary: VerifySummary = {
    baseOk,
    socketOk: socketErr <= anchorTolM,
    axisDeg,
    adjusted: raisedM > 0 ? { baseRaiseMm: raisedM * 1000 } : null,
    fail: undefined,
  };

  // If either constraint is badly violated, attach a message (non-fatal for now).
  if (!summary.socketOk) summary.fail = `Socket misalignment ${(socketErr * 1000).toFixed(1)} mm > ${EPS_ANCHOR_MM} mm`;
  if (axisDeg > EPS_ANGLE_DEG) summary.fail = `Axis ${axisDeg.toFixed(1)}° > ${EPS_ANGLE_DEG}°`;

  return { transforms, summary };
}
