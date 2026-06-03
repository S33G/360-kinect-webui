/**
 * MediaPipe Pose Landmarker tracker.
 *
 * Lazy-loads @mediapipe/tasks-vision and the pose_landmarker_lite model
 * the first time .init() is called. We accept the fact that the model
 * has to be fetched from a CDN at runtime (Google's CDN by default).
 *
 * If @mediapipe/tasks-vision isn't installed at runtime, init() will fail
 * with a clear message — the user can install it via `npm i @mediapipe/tasks-vision`.
 */

import type { Joint, JointName, Skeleton, SkeletonTracker } from "./types";

// MediaPipe BlazePose 33-landmark indices we care about.
// https://developers.google.com/mediapipe/solutions/vision/pose_landmarker
const LM = {
  nose: 0,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
};

export interface MediaPipeOptions {
  /** "lite" or "full" model variant. */
  variant: "lite" | "full";
  /** Mirror landmarks in X (Kinect IR projector view is non-mirrored). */
  mirror: boolean;
}

const MODEL_URLS = {
  lite: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
  full: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task",
};

const WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";

interface MpLandmark {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

interface MpPoseLandmarker {
  detectForVideo(
    image: HTMLCanvasElement | ImageBitmap | OffscreenCanvas,
    timestamp: number,
  ): { landmarks: MpLandmark[][] };
  close(): void;
}

export class MediaPipeSkeletonTracker implements SkeletonTracker {
  readonly id = "mediapipe";
  readonly label = "MediaPipe Pose";

  options: MediaPipeOptions = { variant: "lite", mirror: false };

  private landmarker: MpPoseLandmarker | null = null;
  private offscreen: HTMLCanvasElement | null = null;
  private offCtx: CanvasRenderingContext2D | null = null;
  private initFailed: string | null = null;

  async init(): Promise<void> {
    try {
      const mod = (await import("@mediapipe/tasks-vision")) as unknown as {
        FilesetResolver: { forVisionTasks(url: string): Promise<unknown> };
        PoseLandmarker: {
          createFromOptions(
            fileset: unknown,
            opts: Record<string, unknown>,
          ): Promise<MpPoseLandmarker>;
        };
      };

      const vision = await mod.FilesetResolver.forVisionTasks(WASM_URL);
      this.landmarker = await mod.PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: MODEL_URLS[this.options.variant],
          delegate: "GPU",
        },
        runningMode: "VIDEO",
        numPoses: 1,
        minPoseDetectionConfidence: 0.4,
        minPosePresenceConfidence: 0.4,
        minTrackingConfidence: 0.4,
      });
    } catch (err: unknown) {
      this.initFailed = err instanceof Error ? err.message : String(err);
      throw new Error(
        `MediaPipe Pose unavailable: ${this.initFailed}. ` +
          `Install @mediapipe/tasks-vision and reload.`,
      );
    }
  }

  dispose(): void {
    this.landmarker?.close();
    this.landmarker = null;
  }

  process(frame: ImageData): Skeleton | null {
    if (!this.landmarker) return null;

    // MediaPipe wants a canvas/imagebitmap. Blit the ImageData onto an offscreen.
    if (
      !this.offscreen ||
      this.offscreen.width !== frame.width ||
      this.offscreen.height !== frame.height
    ) {
      this.offscreen = document.createElement("canvas");
      this.offscreen.width = frame.width;
      this.offscreen.height = frame.height;
      this.offCtx = this.offscreen.getContext("2d");
    }
    if (!this.offCtx) return null;

    // ImageData may be Float16-backed; we need to convert to Uint8 first.
    const src = frame.data;
    const tmp =
      src instanceof Uint8ClampedArray
        ? frame
        : (() => {
            const out = this.offCtx!.createImageData(frame.width, frame.height);
            const len = frame.width * frame.height * 4;
            for (let i = 0; i < len; i++) {
              out.data[i] = Math.min(
                255,
                Math.max(0, (src[i] as unknown as number) * 255),
              );
            }
            return out;
          })();
    this.offCtx.putImageData(tmp, 0, 0);

    let result: { landmarks: MpLandmark[][] };
    try {
      result = this.landmarker.detectForVideo(this.offscreen, performance.now());
    } catch {
      return null;
    }
    if (!result.landmarks?.length) return null;

    const lms = result.landmarks[0];
    const W = frame.width;
    const H = frame.height;
    const map = (lm: MpLandmark | undefined): readonly [number, number, number] | null => {
      if (!lm) return null;
      const x = (this.options.mirror ? 1 - lm.x : lm.x) * W;
      const y = lm.y * H;
      return [x, y, lm.visibility ?? 0.8];
    };

    const j: Partial<Record<JointName, Joint>> = {};
    const put = (
      name: JointName,
      pt: readonly [number, number, number] | null,
    ) => {
      if (!pt) return;
      j[name] = { name, x: pt[0], y: pt[1], confidence: pt[2] };
    };

    const nose = map(lms[LM.nose]);
    const sl = map(lms[LM.leftShoulder]);
    const sr = map(lms[LM.rightShoulder]);
    const hl = map(lms[LM.leftHip]);
    const hr = map(lms[LM.rightHip]);

    put("head", nose);
    if (sl && sr) {
      put("neck", [(sl[0] + sr[0]) / 2, (sl[1] + sr[1]) / 2, Math.min(sl[2], sr[2])]);
    }
    if (sl && sr && hl && hr) {
      put("torso", [
        (sl[0] + sr[0] + hl[0] + hr[0]) / 4,
        (sl[1] + sr[1] + hl[1] + hr[1]) / 4,
        Math.min(sl[2], sr[2], hl[2], hr[2]),
      ]);
    }
    put("shoulderL", sl);
    put("shoulderR", sr);
    put("elbowL", map(lms[LM.leftElbow]));
    put("elbowR", map(lms[LM.rightElbow]));
    put("handL", map(lms[LM.leftWrist]));
    put("handR", map(lms[LM.rightWrist]));
    put("hipL", hl);
    put("hipR", hr);
    put("kneeL", map(lms[LM.leftKnee]));
    put("kneeR", map(lms[LM.rightKnee]));
    put("footL", map(lms[LM.leftAnkle]));
    put("footR", map(lms[LM.rightAnkle]));

    return {
      joints: j,
      detectedAt: performance.now(),
      source: this.id,
    };
  }
}
