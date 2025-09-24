import surfacesJson from "@/data/surfaces.json";

export type Vec3 = [number, number, number]; //define a 3D vector type

export type Surface = {             //defines the surface interfaces
  id: "desk" | "monitor1";     
  kind: "desk" | "monitor";
  origin: Vec3;    //anchor point of the surface in world (3d) space
  uAxis: Vec3;    //defines left -> right axis in 2d space
  vAxis: Vec3;    //defines bottom -> top axis in 2d space
  zLift: number;
  clip?: [number, number, number, number];  //allowed rectangle region for surface
};

const registry: Surface[] = (surfacesJson as any).surfaces; //registry loads an array of Surfaces from json file

export function getSurface(id: Surface["id"]): Surface { //getting a surface by its id
  const s = registry.find((r) => r.id === id);
  if (!s) throw new Error(`Surface not found: ${id}`);
  return s;
}

export function getAllSurfaces(): Surface[] {
  return registry;
}
