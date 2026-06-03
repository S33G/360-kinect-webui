/**
 * Skeleton tracker contract.
 *
 * The original Xbox 360 Kinect hardware does not produce skeleton data on its
 * own — Microsoft's NUI runtime did that in the SDK. We implement skeleton
 * tracking client-side from depth frames via either heuristic methods or
 * an in-browser ML model.
 */

export type JointName =
  | "head"
  | "neck"
  | "torso"
  | "shoulderL"
  | "shoulderR"
  | "elbowL"
  | "elbowR"
  | "handL"
  | "handR"
  | "hipL"
  | "hipR"
  | "kneeL"
  | "kneeR"
  | "footL"
  | "footR";

export const ALL_JOINTS: JointName[] = [
  "head",
  "neck",
  "torso",
  "shoulderL",
  "shoulderR",
  "elbowL",
  "elbowR",
  "handL",
  "handR",
  "hipL",
  "hipR",
  "kneeL",
  "kneeR",
  "footL",
  "footR",
];

/** Bone topology used by the renderer. */
export const BONES: Array<[JointName, JointName]> = [
  ["head", "neck"],
  ["neck", "torso"],
  ["neck", "shoulderL"],
  ["neck", "shoulderR"],
  ["shoulderL", "elbowL"],
  ["elbowL", "handL"],
  ["shoulderR", "elbowR"],
  ["elbowR", "handR"],
  ["torso", "hipL"],
  ["torso", "hipR"],
  ["hipL", "kneeL"],
  ["kneeL", "footL"],
  ["hipR", "kneeR"],
  ["kneeR", "footR"],
];

export interface Joint {
  name: JointName;
  x: number;
  y: number;
  z?: number;
  confidence: number;
}

export interface Skeleton {
  joints: Partial<Record<JointName, Joint>>;
  detectedAt: number;
  source: string;
}

export interface SkeletonTracker {
  readonly id: string;
  readonly label: string;
  init(): Promise<void>;
  process(frame: ImageData): Skeleton | null | Promise<Skeleton | null>;
  dispose(): void;
}
