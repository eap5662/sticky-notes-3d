// apps/web/src/canvas/mounts/pose.ts
import * as THREE from 'three';
import type { Surface } from '@/canvas/surfaces';
import { getBasis, uvToWorld } from '@/canvas/math/surfaces_math';
import { mmToM } from './rules';
import type { PoseOutputs, TableStandConfig, Socket, Anchor } from './types';

// Local compatibility for inputs: use canonical Surface (array-based) + our mount params.
export type PoseInputs = {
  deskSurface: Surface;
  monitorSurface: Surface;
  socket: Socket;
  deskAnchor: Anchor;
};

// Project (u,v) to world using the shared math; apply optional lifts along each surface normal.
export function computePose(inputs: PoseInputs, _table?: TableStandConfig): PoseOutputs {
  const { deskSurface, monitorSurface, socket, deskAnchor } = inputs;

  const { U: U_d, V: V_d, N: N_d } = getBasis(deskSurface);
  const { U: U_m, V: V_m, N: N_m } = getBasis(monitorSurface);

  const P_desk_base = uvToWorld(deskAnchor.u, deskAnchor.v, deskSurface);
  const P_sock_base = uvToWorld(socket.u, socket.v, monitorSurface);

  const P_desk = P_desk_base.clone().add(N_d.clone().multiplyScalar(deskAnchor.lift ?? 0));
  const P_sock = P_sock_base.clone().add(N_m.clone().multiplyScalar(socket.lift ?? 0));

  return { P_desk, U_d, V_d, N_d, P_sock, U_m, V_m, N_m };
}

// Build a world-space pose where local +Y points along lookDir (used for neck).
function makePoseObject(position: THREE.Vector3, lookDir: THREE.Vector3, up = new THREE.Vector3(0, 1, 0)) {
  const obj = new THREE.Object3D();
  obj.position.copy(position);

  const y = lookDir.clone().normalize();
  const z = new THREE.Vector3().crossVectors(up, y).normalize();
  const x = new THREE.Vector3().crossVectors(y, z).normalize();

  const m = new THREE.Matrix4().makeBasis(x, y, z);
  obj.quaternion.setFromRotationMatrix(m);
  return obj;
}

// Initial transforms for TableStand parts; verification/auto-adjust happens elsewhere.
export function initialTableStandTransforms(pose: PoseOutputs, cfg: TableStandConfig) {
  const minClearanceM = mmToM(cfg.base.minClearance ?? 2);

  // Base center sits above the desk plane by half its thickness + clearance.
  const baseCenter = pose.P_desk.clone().add(pose.N_d.clone().multiplyScalar(cfg.base.t / 2 + minClearanceM));
  const basePose = new THREE.Object3D();
  basePose.position.copy(baseCenter);
  basePose.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), pose.N_d);
  basePose.scale.set(cfg.base.w, cfg.base.t, cfg.base.d); // x=width, y=thickness, z=depth

  // Neck spans from base top center to the socket point.
  const baseTopCenter = baseCenter.clone().add(pose.N_d.clone().multiplyScalar(cfg.base.t / 2));
  const D = pose.P_sock.clone().sub(baseTopCenter);
  const L = Math.max(D.length(), 1e-6);
  const neckPose = makePoseObject(baseTopCenter, D);
  neckPose.scale.set(cfg.neck.width, L, cfg.neck.depth);

  // Plate sits slightly off the monitor plane to avoid z-fighting.
  const eps = mmToM(1.5);
  const plateCenter = pose.P_sock.clone().add(pose.N_m.clone().multiplyScalar(eps));
  const platePose = new THREE.Object3D();
  platePose.position.copy(plateCenter);
  platePose.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), pose.N_m);
  platePose.scale.set(cfg.plate.w, cfg.plate.t, cfg.plate.h);

  return {
    basePose,
    neckPose,
    platePose,
    neckAxis: D.clone().normalize(),
    standTop: pose.P_sock.clone(),
  };
}
