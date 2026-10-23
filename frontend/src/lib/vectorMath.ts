/**
 * SwingAI — 3-D vector math primitives.
 *
 * Central formula: the angle between vectors u and v,
 *     theta = arccos( (u · v) / (|u| |v|) )
 * clamped into arccos's valid domain for float safety.
 */

export type Vec3 = readonly [number, number, number];

const EPS = 1e-9;

export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const norm = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const mid = (a: Vec3, b: Vec3): Vec3 => [
  (a[0] + b[0]) / 2,
  (a[1] + b[1]) / 2,
  (a[2] + b[2]) / 2,
];

/** Angle in degrees between u and v; 0 for degenerate vectors. */
export function angleBetweenDeg(u: Vec3, v: Vec3): number {
  const nu = norm(u);
  const nv = norm(v);
  if (nu < EPS || nv < EPS) return 0;
  const c = Math.min(1, Math.max(-1, dot(u, v) / (nu * nv)));
  return (Math.acos(c) * 180) / Math.PI;
}

/** Interior angle at joint B (degrees) formed by segments B→A and B→C. */
export function jointAngle3dDeg(a: Vec3, b: Vec3, c: Vec3): number {
  return angleBetweenDeg(sub(a, b), sub(c, b));
}

/** Centered moving average, edge-padded, shape-preserving. */
export function movingAverage(x: readonly number[], window: number): number[] {
  const n = x.length;
  if (window <= 1 || n < 3) return [...x];
  let w = Math.min(window, n % 2 === 1 ? n : n - 1);
  if (w % 2 === 0) w += 1;
  const pad = (w - 1) / 2;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let k = -pad; k <= pad; k++) {
      const idx = Math.min(n - 1, Math.max(0, i + k));
      sum += x[idx] as number;
    }
    out[i] = sum / w;
  }
  return out;
}

/** Numerical gradient (central differences, forward/backward at edges). */
export function gradient(x: readonly number[]): number[] {
  const n = x.length;
  if (n === 0) return [];
  if (n === 1) return [0];
  const out = new Array<number>(n);
  out[0] = (x[1] as number) - (x[0] as number);
  out[n - 1] = (x[n - 1] as number) - (x[n - 2] as number);
  for (let i = 1; i < n - 1; i++) {
    out[i] = ((x[i + 1] as number) - (x[i - 1] as number)) / 2;
  }
  return out;
}

/** Unwrap a phase-angle series (radians) so it is continuous. */
export function unwrap(angles: readonly number[]): number[] {
  const out: number[] = [];
  let offset = 0;
  for (let i = 0; i < angles.length; i++) {
    const a = angles[i] as number;
    if (i > 0) {
      const prev = angles[i - 1] as number;
      let d = a - prev;
      while (d > Math.PI) {
        offset -= 2 * Math.PI;
        d -= 2 * Math.PI;
      }
      while (d < -Math.PI) {
        offset += 2 * Math.PI;
        d += 2 * Math.PI;
      }
    }
    out.push(a + offset);
  }
  return out;
}

export const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, v));

export const argmax = (x: readonly number[]): number => {
  let best = 0;
  for (let i = 1; i < x.length; i++) {
    if ((x[i] as number) > (x[best] as number)) best = i;
  }
  return best;
};
