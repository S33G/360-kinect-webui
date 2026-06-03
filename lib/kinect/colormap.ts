/**
 * Depth colormaps. Each maps a normalized depth value v in [0,1]
 * (1 = closest) to an [r,g,b] triple in [0,255].
 */

import type { ColormapName } from "./types";

export type Rgb = [number, number, number];
export type ColormapFn = (v: number) => Rgb;

function clamp(x: number): number {
  return x < 0 ? 0 : x > 255 ? 255 : x;
}

const grayscale: ColormapFn = (v) => {
  const g = clamp(v * 255);
  return [g, g, g];
};

// Classic MATLAB jet — fast piecewise-linear approximation
const jet: ColormapFn = (v) => {
  const r = clamp(255 * Math.min(Math.max(1.5 - Math.abs(4 * v - 3), 0), 1));
  const g = clamp(255 * Math.min(Math.max(1.5 - Math.abs(4 * v - 2), 0), 1));
  const b = clamp(255 * Math.min(Math.max(1.5 - Math.abs(4 * v - 1), 0), 1));
  return [r, g, b];
};

// Viridis approximation (perceptually uniform)
const viridis: ColormapFn = (v) => {
  const r = clamp(255 * (0.267 + 1.4 * v - 1.7 * v * v + 0.5 * v * v * v));
  const g = clamp(255 * (0.005 + 1.4 * v - 0.7 * v * v));
  const b = clamp(255 * (0.329 + 1.2 * v - 2.1 * v * v + 0.8 * v * v * v));
  return [r, g, b];
};

// Turbo approximation
const turbo: ColormapFn = (v) => {
  const r = clamp(255 * (0.135 + 4.6 * v - 4.3 * v * v));
  const g = clamp(255 * (0.091 + 2.2 * v + 1.0 * v * v - 2.3 * v * v * v));
  const b = clamp(255 * (0.107 + 5.1 * v - 13 * v * v + 7.8 * v * v * v));
  return [r, g, b];
};

// Thermal: black -> red -> yellow -> white
const thermal: ColormapFn = (v) => {
  const r = clamp(v * 4 * 255);
  const g = clamp((v - 0.25) * 4 * 255);
  const b = clamp((v - 0.5) * 4 * 255);
  return [r, g, b];
};

// HSV rainbow (full hue sweep)
const rainbow: ColormapFn = (v) => {
  const h = (1 - v) * 240; // hue degrees: 240 (blue, far) -> 0 (red, near)
  const s = 1;
  const l = 0.5;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let rp = 0,
    gp = 0,
    bp = 0;
  if (hp < 1) [rp, gp, bp] = [c, x, 0];
  else if (hp < 2) [rp, gp, bp] = [x, c, 0];
  else if (hp < 3) [rp, gp, bp] = [0, c, x];
  else if (hp < 4) [rp, gp, bp] = [0, x, c];
  else if (hp < 5) [rp, gp, bp] = [x, 0, c];
  else [rp, gp, bp] = [c, 0, x];
  const m = l - c / 2;
  return [clamp((rp + m) * 255), clamp((gp + m) * 255), clamp((bp + m) * 255)];
};

const MAP: Record<ColormapName, ColormapFn> = {
  grayscale,
  jet,
  viridis,
  turbo,
  thermal,
  rainbow,
};

export function getColormap(name: ColormapName): ColormapFn {
  return MAP[name] || grayscale;
}

/** Build a 256-entry RGB LUT for fast per-pixel lookup. */
export function buildLut(name: ColormapName): Uint8Array {
  const fn = getColormap(name);
  const lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const [r, g, b] = fn(i / 255);
    lut[i * 3] = r;
    lut[i * 3 + 1] = g;
    lut[i * 3 + 2] = b;
  }
  return lut;
}
