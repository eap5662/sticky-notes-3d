// Single source of truth for tolerances & helpers
export const EPS_ANCHOR_MM = 3;        // acceptable attach error
export const EPS_ANGLE_DEG = 8;        // neck axis tolerance
export const AUTO_RAISE_CAP_MM = 5;    // one-shot base auto-raise cap

export const DEFAULT_MIN_CLEARANCE_MM = 2; // 2–3 mm; pick 2 as default, caller can override

// Unit conversions & math helpers
export const mmToM = (mm: number) => mm / 1000;
export const degToRad = (deg: number) => (deg * Math.PI) / 180;
export const radToDeg = (rad: number) => (rad * 180) / Math.PI;