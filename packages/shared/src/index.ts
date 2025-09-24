export type Note = {
  id: string;
  surfaceId: "desk" | "monitor1";
  x: number;   // normalized 0..1
  y: number;   // normalized 0..1
  rot: number; // radians
  color: string; // hex like #FFDA00
  text?: string;
  updatedAt: string; // ISO
};
