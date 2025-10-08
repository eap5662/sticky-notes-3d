export type ViewId = 'wide' | 'screen';

export type CameraPose = {
  yaw: number;
  pitch: number;
  dolly: number;
};

export type CameraClamps = {
  yaw: { min: number; max: number };
  pitch: { min: number; max: number };
  dolly: { min: number; max: number };
};
