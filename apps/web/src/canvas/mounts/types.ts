// apps/web/src/canvas/mounts/types.ts
import * as THREE from 'three';

export type SurfaceId = 'desk' | 'monitor1' | 'monitor2';

export type Socket = { u: number; v: number; lift?: number }; // local to parent object (e.g. monitor)
export type Anchor = { surfaceId: SurfaceId; u: number; v: number; lift?: number }; // local to surface

export type MonitorConfig = {
  surfaceId: 'monitor1';
  socket: Socket;
  mount: { variant: 'tableStand' | 'vesaArm' | 'wall' | 'none'; config?: unknown };
};

// Minimal parametric config for this sprint (table stand):
export type TableStandConfig = {
  deskAnchor: Anchor;
  base: { w: number; d: number; t: number; fillet?: number; minClearance?: number };
  neck: { width: number; depth: number };
  plate: { w: number; h: number; t: number };
};

// Stable Mount API (variant adapters implement this)
export type MountPartType = 'base' | 'neck' | 'plate' | 'link';
export type MountPart = {
  type: MountPartType;
  // World-space pose; unit/local geometry should be meshed and then transformed by this.
  pose: THREE.Object3D; // carries position/quaternion/scale; parent left null (world)
  localGeometryHint?: 'box' | 'cylinder' | 'roundedRect' | 'gltf';
  // Optional hooks for verification (semantic, not triangles)
  contactSurfaces?: () => { plane: THREE.Plane }[];   // plane (eg base bottom)
  attachPoints?: () => { standTop: THREE.Vector3 };   // 3d point world pos
  neckAxisDir?: () => THREE.Vector3;                  // world-space direction (normalized)
};

export type MountBuild = {
  parts: MountPart[];
  attachPoints: {
    standBaseContact: THREE.Vector3;  // point on base bottom (world)
    standTopAttach: THREE.Vector3;    // top of neck (world)
    neckAxis: THREE.Vector3;          // axis direction (world, normalized)
  };
};

export type PoseInputs = {
  deskSurface: SurfaceLike;    //SurfaceLike resembles a surface but
  monitorSurface: SurfaceLike; //Surface is reserved for monitor/desk
  socket: Socket;
  deskAnchor: Anchor;
};

export type PoseOutputs = {
  /*
  P_desk = desk anchor point in world coords
  P_sock = monitor socket point in world coords
  */
  P_desk: THREE.Vector3; U_d: THREE.Vector3; V_d: THREE.Vector3; N_d: THREE.Vector3;
  P_sock: THREE.Vector3; U_m: THREE.Vector3; V_m: THREE.Vector3; N_m: THREE.Vector3;
};

export type VerifySummary = {
  baseOk: boolean;
  socketOk: boolean;
  axisDeg: number;
  adjusted: { baseRaiseMm?: number; neckNudgeMm?: number } | null;
  fail?: string; // message if fail state
};

// Minimal surface interface to avoid tight coupling
export type SurfaceLike = {
  id: SurfaceId;
  origin: THREE.Vector3;
  uAxis: THREE.Vector3;  // world direction with magnitude = surface meter scale
  vAxis: THREE.Vector3;
  // desk/monitor normal implied by u×v (right-handed); we’ll normalize in math.
};
