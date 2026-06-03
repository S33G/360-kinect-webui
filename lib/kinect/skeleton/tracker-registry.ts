/**
 * Registry of available skeleton trackers.
 */

import { HeuristicSkeletonTracker } from "./heuristic-tracker";
import { MediaPipeSkeletonTracker } from "./mediapipe-tracker";
import type { SkeletonTracker } from "./types";

export interface TrackerEntry {
  id: string;
  label: string;
  description: string;
  factory: () => SkeletonTracker;
}

export const TRACKERS: TrackerEntry[] = [
  {
    id: "heuristic",
    label: "Heuristic (depth)",
    description:
      "Pure depth-only blob analysis. Fast, no deps, ~15 joints derived geometrically.",
    factory: () => new HeuristicSkeletonTracker(),
  },
  {
    id: "mediapipe",
    label: "MediaPipe Pose",
    description:
      "Google MediaPipe BlazePose (lite). Requires @mediapipe/tasks-vision and downloads a model on init.",
    factory: () => new MediaPipeSkeletonTracker(),
  },
];

export function getTracker(id: string): TrackerEntry | undefined {
  return TRACKERS.find((t) => t.id === id);
}
