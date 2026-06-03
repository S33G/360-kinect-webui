/**
 * Bubble Pop game engine.
 *
 * Bubbles spawn at random positions. The player "pops" them by moving
 * their near-depth blob (hand/body) over a bubble. Simple and fun
 * for Kinect R&D testing.
 */

import type { Blob } from "./canvas-renderer";

export interface Bubble {
  id: number;
  x: number;
  y: number;
  radius: number;
  color: string;
  /** Vertical speed (pixels per frame) */
  vy: number;
  popped: boolean;
  popFrame: number;
}

export interface BubbleGameState {
  bubbles: Bubble[];
  score: number;
  nextId: number;
  frameCount: number;
  canvasWidth: number;
  canvasHeight: number;
}

const BUBBLE_COLORS = [
  "#ff6b6b",
  "#4ecdc4",
  "#45b7d1",
  "#f9ca24",
  "#6c5ce7",
  "#fd79a8",
  "#00cec9",
  "#e17055",
  "#a29bfe",
  "#55efc4",
];

export function createBubbleGame(
  canvasWidth: number,
  canvasHeight: number,
): BubbleGameState {
  return {
    bubbles: [],
    score: 0,
    nextId: 0,
    frameCount: 0,
    canvasWidth,
    canvasHeight,
  };
}

function spawnBubble(state: BubbleGameState): Bubble {
  const radius = 20 + Math.random() * 30;
  const bubble: Bubble = {
    id: state.nextId++,
    x: radius + Math.random() * (state.canvasWidth - radius * 2),
    y: state.canvasHeight + radius,
    radius,
    color: BUBBLE_COLORS[Math.floor(Math.random() * BUBBLE_COLORS.length)],
    vy: -(1.0 + Math.random() * 1.5),
    popped: false,
    popFrame: 0,
  };
  return bubble;
}

/**
 * Advance the game by one frame. Spawns bubbles, moves them,
 * checks blob collision, and cleans up off-screen/popped bubbles.
 */
export function tickBubbleGame(
  state: BubbleGameState,
  blob: { cx: number; cy: number } | null,
): BubbleGameState {
  state.frameCount++;

  // Spawn new bubbles every ~40 frames
  if (state.frameCount % 40 === 0) {
    state.bubbles.push(spawnBubble(state));
  }
  // Occasional double spawn for variety
  if (state.frameCount % 120 === 0) {
    state.bubbles.push(spawnBubble(state));
  }

  // Move bubbles upward
  for (const b of state.bubbles) {
    if (!b.popped) {
      b.y += b.vy;
    }
  }

  // Check blob collision
  if (blob) {
    for (const b of state.bubbles) {
      if (b.popped) continue;
      const dx = blob.cx - b.x;
      const dy = blob.cy - b.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      // Pop if blob center is within bubble radius + some tolerance
      if (dist < b.radius + 30) {
        b.popped = true;
        b.popFrame = state.frameCount;
        state.score++;
      }
    }
  }

  // Remove off-screen and old-popped bubbles
  state.bubbles = state.bubbles.filter((b) => {
    if (b.popped && state.frameCount - b.popFrame > 15) return false;
    if (!b.popped && b.y + b.radius < -20) return false;
    return true;
  });

  return state;
}

/**
 * Draw the bubble game overlay.
 */
export function drawBubbleGame(
  ctx: CanvasRenderingContext2D,
  state: BubbleGameState,
  blob: { cx: number; cy: number } | null,
): void {
  // Draw bubbles
  for (const b of state.bubbles) {
    ctx.beginPath();

    if (b.popped) {
      // Pop animation: expanding fading ring
      const age = state.frameCount - b.popFrame;
      const expandRadius = b.radius + age * 4;
      const alpha = Math.max(0, 1 - age / 15);
      ctx.arc(b.x, b.y, expandRadius, 0, Math.PI * 2);
      ctx.strokeStyle = b.color + Math.round(alpha * 255).toString(16).padStart(2, "0");
      ctx.lineWidth = 3;
      ctx.stroke();
    } else {
      // Normal bubble
      ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
      ctx.fillStyle = b.color + "44"; // semi-transparent fill
      ctx.fill();
      ctx.strokeStyle = b.color;
      ctx.lineWidth = 2;
      ctx.stroke();

      // Shine highlight
      ctx.beginPath();
      ctx.arc(
        b.x - b.radius * 0.3,
        b.y - b.radius * 0.3,
        b.radius * 0.2,
        0,
        Math.PI * 2,
      );
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.fill();
    }
  }

  // Draw blob cursor
  if (blob) {
    ctx.beginPath();
    ctx.arc(blob.cx, blob.cy, 15, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0, 255, 136, 0.5)";
    ctx.fill();
    ctx.strokeStyle = "#00ff88";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // Draw score
  ctx.fillStyle = "#00ff88";
  ctx.font = "bold 24px monospace";
  ctx.textAlign = "left";
  ctx.fillText(`Score: ${state.score}`, 16, 36);
}
