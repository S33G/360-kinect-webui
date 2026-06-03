/**
 * Smooth cursor tracking from Kinect depth data.
 *
 * Features:
 * - Position smoothing (reduces jitter)
 * - Trail effect (helps visualize movement)
 * - Configurable depth threshold
 * - Visual feedback on tracking state
 */

import type { Blob } from "./canvas-renderer";

export interface CursorState {
  x: number;
  y: number;
  smoothX: number;
  smoothY: number;
  trail: Array<{ x: number; y: number; age: number }>;
  isTracking: boolean;
  depthThreshold: number;
  smoothingFactor: number;
}

const TRAIL_LENGTH = 15;
const TRAIL_MAX_AGE = 30;

export function createCursorState(
  depthThreshold: number = 0.5,
  smoothingFactor: number = 0.15,
): CursorState {
  return {
    x: 0,
    y: 0,
    smoothX: 0,
    smoothY: 0,
    trail: [],
    isTracking: false,
    depthThreshold,
    smoothingFactor,
  };
}

export function updateCursor(
  state: CursorState,
  blob: Blob | null,
  canvasWidth: number,
  canvasHeight: number,
): CursorState {
  if (blob && blob.pixelCount >= 30) {
    state.x = blob.cx;
    state.y = blob.cy;

    if (!state.isTracking) {
      state.smoothX = blob.cx;
      state.smoothY = blob.cy;
    } else {
      state.smoothX += (blob.cx - state.smoothX) * state.smoothingFactor;
      state.smoothY += (blob.cy - state.smoothY) * state.smoothingFactor;
    }
    state.isTracking = true;

    state.trail.unshift({ x: state.smoothX, y: state.smoothY, age: 0 });
    if (state.trail.length > TRAIL_LENGTH) {
      state.trail.pop();
    }
  } else {
    state.isTracking = false;
  }

  for (let i = state.trail.length - 1; i >= 0; i--) {
    state.trail[i].age++;
    if (state.trail[i].age > TRAIL_MAX_AGE) {
      state.trail.splice(i, 1);
    }
  }

  return state;
}

export function drawCursor(
  ctx: CanvasRenderingContext2D,
  state: CursorState,
  canvasWidth: number,
  canvasHeight: number,
): void {
  if (state.trail.length > 1) {
    ctx.beginPath();
    ctx.moveTo(state.trail[0].x, state.trail[0].y);
    for (let i = 1; i < state.trail.length; i++) {
      const t = state.trail[i];
      const alpha = Math.max(0, 1 - t.age / TRAIL_MAX_AGE);
      ctx.lineTo(t.x, t.y);
    }
    ctx.strokeStyle = "rgba(0, 255, 136, 0.3)";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
  }

  for (let i = state.trail.length - 1; i >= 0; i--) {
    const t = state.trail[i];
    const alpha = Math.max(0, 1 - t.age / TRAIL_MAX_AGE);
    const radius = 8 * alpha;
    if (radius > 1) {
      ctx.beginPath();
      ctx.arc(t.x, t.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(0, 255, 136, ${alpha * 0.4})`;
      ctx.fill();
    }
  }

  if (state.isTracking) {
    ctx.beginPath();
    ctx.arc(state.smoothX, state.smoothY, 20, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0, 255, 136, 0.3)";
    ctx.fill();
    ctx.strokeStyle = "#00ff88";
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(state.smoothX, state.smoothY, 8, 0, Math.PI * 2);
    ctx.fillStyle = "#00ff88";
    ctx.fill();

    ctx.strokeStyle = "rgba(0, 255, 136, 0.6)";
    ctx.lineWidth = 2;
    const crossSize = 35;
    ctx.beginPath();
    ctx.moveTo(state.smoothX - crossSize, state.smoothY);
    ctx.lineTo(state.smoothX - 25, state.smoothY);
    ctx.moveTo(state.smoothX + 25, state.smoothY);
    ctx.lineTo(state.smoothX + crossSize, state.smoothY);
    ctx.moveTo(state.smoothX, state.smoothY - crossSize);
    ctx.lineTo(state.smoothX, state.smoothY - 25);
    ctx.moveTo(state.smoothX, state.smoothY + 25);
    ctx.lineTo(state.smoothX, state.smoothY + crossSize);
    ctx.stroke();
  }

  ctx.fillStyle = state.isTracking ? "#00ff88" : "#666";
  ctx.font = "bold 14px monospace";
  ctx.textAlign = "right";
  ctx.fillText(
    `Threshold: ${state.depthThreshold.toFixed(2)}`,
    canvasWidth - 16,
    canvasHeight - 16,
  );

  if (!state.isTracking && state.trail.length === 0) {
    ctx.fillStyle = "#888";
    ctx.font = "bold 16px monospace";
    ctx.textAlign = "center";
    ctx.fillText(
      "Move your hand closer to the camera",
      canvasWidth / 2,
      canvasHeight / 2,
    );
    ctx.font = "12px monospace";
    ctx.fillText(
      "Brighter areas in the depth view = closer objects",
      canvasWidth / 2,
      canvasHeight / 2 + 24,
    );
  }
}
