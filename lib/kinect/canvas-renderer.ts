/**
 * Canvas rendering helpers for Kinect depth/IR/visible frames.
 *
 * Depth frames from @webnect/driver arrive as CamImageData with
 * Float16 RGBA pixels in [0,1]. We convert to Uint8 RGBA on demand
 * with an optional colormap LUT applied.
 */

import { buildLut } from "./colormap";
import type { ColormapName } from "./types";

interface CachedLut {
  name: ColormapName;
  lut: Uint8Array;
}

interface DepthDrawCache {
  output?: ImageData;
  lut?: CachedLut;
}

/**
 * Draw an ImageData with optional colormap remapping (applied to R channel
 * which is treated as the depth value).
 *
 * For raw RGB visible-light frames, pass colormap="grayscale" (it will
 * just pass-through the RGB bytes).
 */
export function drawFrame(
  ctx: CanvasRenderingContext2D,
  imageData: ImageData,
  colormap: ColormapName = "grayscale",
  applyColormap: boolean = true,
): void {
  const src = imageData.data;
  const w = imageData.width;
  const h = imageData.height;
  const len = w * h * 4;

  const ctxAny = ctx as unknown as { __depthCache?: DepthDrawCache };
  if (!ctxAny.__depthCache) ctxAny.__depthCache = {};
  const cache = ctxAny.__depthCache;

  if (!cache.output || cache.output.width !== w || cache.output.height !== h) {
    cache.output = ctx.createImageData(w, h);
  }
  const dst = cache.output.data;

  if (applyColormap && colormap !== "grayscale") {
    if (!cache.lut || cache.lut.name !== colormap) {
      cache.lut = { name: colormap, lut: buildLut(colormap) };
    }
    const lut = cache.lut.lut;
    if (src instanceof Uint8ClampedArray) {
      for (let i = 0, j = 0; i < len; i += 4, j += 3) {
        const v = src[i];
        dst[i] = lut[v * 3];
        dst[i + 1] = lut[v * 3 + 1];
        dst[i + 2] = lut[v * 3 + 2];
        dst[i + 3] = 255;
      }
    } else {
      for (let i = 0; i < len; i += 4) {
        const v = Math.min(
          255,
          Math.max(0, (src[i] as unknown as number) * 255),
        );
        const idx = (v | 0) * 3;
        dst[i] = lut[idx];
        dst[i + 1] = lut[idx + 1];
        dst[i + 2] = lut[idx + 2];
        dst[i + 3] = 255;
      }
    }
  } else {
    if (src instanceof Uint8ClampedArray) {
      dst.set(src);
    } else {
      for (let i = 0; i < len; i++) {
        dst[i] = Math.min(
          255,
          Math.max(0, (src[i] as unknown as number) * 255),
        );
      }
    }
  }

  ctx.putImageData(cache.output, 0, 0);
}

/** Back-compat: same as drawFrame with default grayscale (no remap). */
export function drawDepthFrame(
  ctx: CanvasRenderingContext2D,
  imageData: ImageData,
): void {
  drawFrame(ctx, imageData, "grayscale", false);
}

// ---- Blob tracking ----

export interface Blob {
  cx: number;
  cy: number;
  pixelCount: number;
  peakDepth: number;
}

export function findNearestBlob(
  imageData: ImageData,
  minThreshold: number = 0.3,
  depthBand: number = 0.12,
): Blob | null {
  const src = imageData.data;
  const w = imageData.width;
  const h = imageData.height;
  const step = 2;

  const readDepth = (idx: number): number => {
    const r = src[idx] as unknown as number;
    return r > 1 ? r / 255 : r;
  };

  let peak = 0;
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const val = readDepth((y * w + x) * 4);
      if (val > peak) peak = val;
    }
  }

  if (peak < minThreshold) return null;
  const lower = Math.max(minThreshold, peak - depthBand);

  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const val = readDepth((y * w + x) * 4);
      if (val >= lower) {
        sumX += x;
        sumY += y;
        count++;
      }
    }
  }

  if (count < 20) return null;

  return {
    cx: sumX / count,
    cy: sumY / count,
    pixelCount: count * step * step,
    peakDepth: peak,
  };
}

export function drawBlobOverlay(
  ctx: CanvasRenderingContext2D,
  blob: Blob,
): void {
  const radius = Math.min(60, Math.sqrt(blob.pixelCount) / 2);
  ctx.beginPath();
  ctx.arc(blob.cx, blob.cy, radius, 0, Math.PI * 2);
  ctx.strokeStyle = "#00ff88";
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(blob.cx - 10, blob.cy);
  ctx.lineTo(blob.cx + 10, blob.cy);
  ctx.moveTo(blob.cx, blob.cy - 10);
  ctx.lineTo(blob.cx, blob.cy + 10);
  ctx.strokeStyle = "#00ff88";
  ctx.lineWidth = 1;
  ctx.stroke();
}
