export const TAU = Math.PI * 2;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, k: number): number {
  return a + (b - a) * k;
}

/** Shortest signed angle from `from` to `to`, in (-PI, PI]. */
export function angleDiff(from: number, to: number): number {
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d <= -Math.PI) d += TAU;
  return d;
}

export function turnToward(cur: number, target: number, maxStep: number): number {
  const d = angleDiff(cur, target);
  return Math.abs(d) <= maxStep ? target : cur + Math.sign(d) * maxStep;
}

/** Yaw convention everywhere: forward = (sin yaw, cos yaw) on the XZ plane. */
export function yawOf(dx: number, dz: number): number {
  return Math.atan2(dx, dz);
}

export function dist(ax: number, az: number, bx: number, bz: number): number {
  return Math.hypot(ax - bx, az - bz);
}
