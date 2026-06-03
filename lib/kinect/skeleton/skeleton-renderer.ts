/**
 * Render a Skeleton onto a 2D canvas.
 */

import { BONES, type JointName, type Skeleton } from "./types";

export interface SkeletonRenderOptions {
  showJoints: boolean;
  showBones: boolean;
  showLabels: boolean;
  confidenceFilter: number;
  jointColor: string;
  boneColor: string;
  jointRadius: number;
  boneWidth: number;
  /** If true, draw a thin black halo to make overlays readable on busy backgrounds. */
  halo: boolean;
}

export const DEFAULT_SKELETON_RENDER: SkeletonRenderOptions = {
  showJoints: true,
  showBones: true,
  showLabels: false,
  confidenceFilter: 0.15,
  jointColor: "#00ff88",
  boneColor: "#00ddff",
  jointRadius: 6,
  boneWidth: 3,
  halo: true,
};

export function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  skeleton: Skeleton,
  opts: Partial<SkeletonRenderOptions> = {},
): void {
  const o = { ...DEFAULT_SKELETON_RENDER, ...opts };
  const J = skeleton.joints;

  if (o.showBones) {
    for (const [a, b] of BONES) {
      const ja = J[a as JointName];
      const jb = J[b as JointName];
      if (!ja || !jb) continue;
      if (ja.confidence < o.confidenceFilter || jb.confidence < o.confidenceFilter)
        continue;
      const minConf = Math.min(ja.confidence, jb.confidence);
      if (o.halo) {
        ctx.beginPath();
        ctx.moveTo(ja.x, ja.y);
        ctx.lineTo(jb.x, jb.y);
        ctx.strokeStyle = "rgba(0,0,0,0.6)";
        ctx.lineWidth = o.boneWidth + 2;
        ctx.lineCap = "round";
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(ja.x, ja.y);
      ctx.lineTo(jb.x, jb.y);
      ctx.strokeStyle = o.boneColor;
      ctx.globalAlpha = 0.4 + 0.6 * minConf;
      ctx.lineWidth = o.boneWidth;
      ctx.lineCap = "round";
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  if (o.showJoints) {
    for (const name of Object.keys(J) as JointName[]) {
      const j = J[name];
      if (!j || j.confidence < o.confidenceFilter) continue;
      if (o.halo) {
        ctx.beginPath();
        ctx.arc(j.x, j.y, o.jointRadius + 2, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(0,0,0,0.7)";
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(j.x, j.y, o.jointRadius, 0, Math.PI * 2);
      ctx.fillStyle = o.jointColor;
      ctx.globalAlpha = 0.4 + 0.6 * j.confidence;
      ctx.fill();
      ctx.globalAlpha = 1;
      if (o.showLabels) {
        ctx.fillStyle = "#fff";
        ctx.font = "10px monospace";
        ctx.textAlign = "left";
        ctx.fillText(name, j.x + o.jointRadius + 4, j.y + 3);
      }
    }
  }
}

/** Clear a canvas and draw skeleton on a dark background (side-by-side view). */
export function drawSkeletonStandalone(
  ctx: CanvasRenderingContext2D,
  skeleton: Skeleton | null,
  width: number,
  height: number,
  opts: Partial<SkeletonRenderOptions> = {},
): void {
  ctx.fillStyle = "#0a0a0a";
  ctx.fillRect(0, 0, width, height);

  // Grid background for spatial reference
  ctx.strokeStyle = "#1a1a1a";
  ctx.lineWidth = 1;
  for (let x = 0; x < width; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 0; y < height; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  if (!skeleton) {
    ctx.fillStyle = "#444";
    ctx.font = "14px monospace";
    ctx.textAlign = "center";
    ctx.fillText("No skeleton detected", width / 2, height / 2);
    return;
  }
  drawSkeleton(ctx, skeleton, opts);

  // HUD
  ctx.fillStyle = "#5cb85c";
  ctx.font = "11px monospace";
  ctx.textAlign = "left";
  const detected = Object.values(skeleton.joints).filter(
    (j) => j && j.confidence >= (opts.confidenceFilter ?? 0.15),
  ).length;
  ctx.fillText(`source: ${skeleton.source}`, 8, 14);
  ctx.fillText(`joints: ${detected}/15`, 8, 28);
}
