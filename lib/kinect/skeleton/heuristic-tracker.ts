/**
 * Heuristic depth-only skeleton tracker.
 *
 * Pipeline:
 *  1. Threshold the depth frame to a binary foreground mask.
 *  2. Find the largest connected component (subsampled).
 *  3. Derive joint positions from the blob's spatial structure:
 *     - head: topmost cluster within blob
 *     - torso: centroid
 *     - shoulders: left/right edges at ~head + headHeight band
 *     - hands: leftmost/rightmost extrema in the upper-half band
 *     - hips: left/right at lower-mid band
 *     - knees/feet: bottom band split L/R
 *
 * No external dependencies. Runs synchronously per frame.
 */

import type { Joint, JointName, Skeleton, SkeletonTracker } from "./types";

interface BlobStats {
  pixels: Array<[number, number]>;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  cx: number;
  cy: number;
}

export interface HeuristicOptions {
  /** Minimum normalized depth (0..1) to count as foreground. Default 0.35. */
  threshold: number;
  /** Subsample step for the connected-components scan. Default 4. */
  step: number;
  /** Minimum blob pixel count (in sample units) to track. Default 80. */
  minBlobPixels: number;
}

export class HeuristicSkeletonTracker implements SkeletonTracker {
  readonly id = "heuristic";
  readonly label = "Heuristic (depth)";

  options: HeuristicOptions = {
    threshold: 0.35,
    step: 4,
    minBlobPixels: 80,
  };

  async init(): Promise<void> {
    /* nothing */
  }

  dispose(): void {
    /* nothing */
  }

  process(frame: ImageData): Skeleton | null {
    const blob = this.findLargestBlob(frame);
    if (!blob) return null;
    return this.deriveSkeleton(blob);
  }

  // --- internals ---

  private readDepth(src: ImageData["data"], idx: number): number {
    const r = src[idx] as unknown as number;
    return r > 1 ? r / 255 : r;
  }

  private findLargestBlob(frame: ImageData): BlobStats | null {
    const w = frame.width;
    const h = frame.height;
    const { step, threshold, minBlobPixels } = this.options;
    const src = frame.data;

    const sw = Math.ceil(w / step);
    const sh = Math.ceil(h / step);
    const mask = new Uint8Array(sw * sh);

    for (let sy = 0; sy < sh; sy++) {
      for (let sx = 0; sx < sw; sx++) {
        const x = sx * step;
        const y = sy * step;
        if (x >= w || y >= h) continue;
        const v = this.readDepth(src, (y * w + x) * 4);
        if (v >= threshold) mask[sy * sw + sx] = 1;
      }
    }

    // BFS to find connected components. Keep the largest.
    const visited = new Uint8Array(sw * sh);
    const queue = new Int32Array(sw * sh);
    let bestPixels: Array<[number, number]> = [];

    for (let i = 0; i < sw * sh; i++) {
      if (!mask[i] || visited[i]) continue;
      let head = 0;
      let tail = 0;
      queue[tail++] = i;
      visited[i] = 1;
      const local: Array<[number, number]> = [];

      while (head < tail) {
        const idx = queue[head++];
        const cx = idx % sw;
        const cy = (idx / sw) | 0;
        local.push([cx * step, cy * step]);

        // 4-connected
        const neigh = [
          [cx + 1, cy],
          [cx - 1, cy],
          [cx, cy + 1],
          [cx, cy - 1],
        ];
        for (const [nx, ny] of neigh) {
          if (nx < 0 || ny < 0 || nx >= sw || ny >= sh) continue;
          const nidx = ny * sw + nx;
          if (!mask[nidx] || visited[nidx]) continue;
          visited[nidx] = 1;
          queue[tail++] = nidx;
        }
      }

      if (local.length > bestPixels.length) bestPixels = local;
    }

    if (bestPixels.length < minBlobPixels) return null;

    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    let sumX = 0,
      sumY = 0;
    for (const [x, y] of bestPixels) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      sumX += x;
      sumY += y;
    }
    const n = bestPixels.length;
    return {
      pixels: bestPixels,
      minX,
      maxX,
      minY,
      maxY,
      cx: sumX / n,
      cy: sumY / n,
    };
  }

  private deriveSkeleton(blob: BlobStats): Skeleton {
    const { minX, maxX, minY, maxY, cx, cy, pixels } = blob;
    const height = maxY - minY;
    const width = maxX - minX;
    const headBandY = minY + height * 0.08;
    const shoulderY = minY + height * 0.22;
    const elbowY = minY + height * 0.4;
    const handY = minY + height * 0.48;
    const hipY = minY + height * 0.6;
    const kneeY = minY + height * 0.8;
    const footY = minY + height * 0.95;

    // Find pixels nearest each band; split into left/right by cx.
    const inBand = (target: number, tol: number, side?: "L" | "R") => {
      const within = pixels.filter(
        ([px, py]) =>
          Math.abs(py - target) <= tol &&
          (side === "L" ? px <= cx : side === "R" ? px >= cx : true),
      );
      if (!within.length) return null;
      let sx = 0,
        sy = 0;
      for (const [px, py] of within) {
        sx += px;
        sy += py;
      }
      return [sx / within.length, sy / within.length, within.length] as const;
    };

    const extremum = (
      target: number,
      tol: number,
      side: "L" | "R",
    ): readonly [number, number, number] | null => {
      const within = pixels.filter(([, py]) => Math.abs(py - target) <= tol);
      if (!within.length) return null;
      let best = within[0];
      for (const p of within) {
        if (side === "L" ? p[0] < best[0] : p[0] > best[0]) best = p;
      }
      return [best[0], best[1], within.length];
    };

    const tol = Math.max(8, height * 0.05);
    const wideTol = Math.max(12, height * 0.08);

    const headPt = inBand(headBandY, tol);
    const neckY = headPt ? headPt[1] + height * 0.08 : minY + height * 0.16;
    const neckPt = inBand(neckY, tol);

    const torsoPt: readonly [number, number, number] = [cx, cy, pixels.length];
    const shoulderL = inBand(shoulderY, wideTol, "L");
    const shoulderR = inBand(shoulderY, wideTol, "R");
    const elbowL = inBand(elbowY, wideTol, "L");
    const elbowR = inBand(elbowY, wideTol, "R");
    const handL = extremum(handY, wideTol * 2, "L");
    const handR = extremum(handY, wideTol * 2, "R");
    const hipL = inBand(hipY, wideTol, "L");
    const hipR = inBand(hipY, wideTol, "R");
    const kneeL = inBand(kneeY, wideTol, "L");
    const kneeR = inBand(kneeY, wideTol, "R");
    const footL = inBand(footY, wideTol, "L");
    const footR = inBand(footY, wideTol, "R");

    const joints: Partial<Record<JointName, Joint>> = {};
    const setJoint = (
      name: JointName,
      pt: readonly [number, number, number] | null,
    ) => {
      if (!pt) return;
      const conf = Math.min(1, pt[2] / 30);
      joints[name] = { name, x: pt[0], y: pt[1], confidence: conf };
    };

    setJoint("head", headPt);
    setJoint("neck", neckPt);
    joints.torso = {
      name: "torso",
      x: torsoPt[0],
      y: torsoPt[1],
      confidence: 1,
    };
    setJoint("shoulderL", shoulderL);
    setJoint("shoulderR", shoulderR);
    setJoint("elbowL", elbowL);
    setJoint("elbowR", elbowR);
    setJoint("handL", handL);
    setJoint("handR", handR);
    setJoint("hipL", hipL);
    setJoint("hipR", hipR);
    setJoint("kneeL", kneeL);
    setJoint("kneeR", kneeR);
    setJoint("footL", footL);
    setJoint("footR", footR);

    // Down-weight joints if the blob is too narrow (likely a hand, not a body).
    if (width < height * 0.3) {
      for (const k of Object.keys(joints) as JointName[]) {
        if (k !== "head" && k !== "torso") {
          joints[k]!.confidence *= 0.4;
        }
      }
    }

    return {
      joints,
      detectedAt: performance.now(),
      source: this.id,
    };
  }
}
