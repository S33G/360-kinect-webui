/**
 * Shared types for the Kinect dev/test studio.
 */

export type KinectStatus =
  | "idle"
  | "checking"
  | "requesting-device"
  | "connecting"
  | "streaming"
  | "stopping"
  | "error";

export type KinectError = {
  code:
    | "WEBUSB_UNSUPPORTED"
    | "NO_DEVICE"
    | "PERMISSION_DENIED"
    | "CONNECT_FAILED"
    | "STREAM_FAILED"
    | "MOTOR_UNAVAILABLE"
    | "REGISTER_FAILED"
    | "MODE_INVALID"
    | "UNKNOWN";
  message: string;
};

export type PreviewMode =
  | "depth-preview"
  | "blob-tracking"
  | "cursor-mode"
  | "bubble-pop"
  | "skeleton"
  | "none";

export type StreamKind = "depth" | "video";
export type VideoSource = "visible" | "infrared";

export type Resolution = "QVGA" | "VGA" | "SXGA";
export type Fps = 15 | 30;

export interface DepthStreamConfig {
  enabled: boolean;
  resolution: Resolution;
  fps: Fps;
  flip: boolean;
  /** "10b" or "11b" */
  format: "10b" | "11b";
}

export interface VideoStreamConfig {
  enabled: boolean;
  /** Visible RGB or Infrared. Cannot be both at once on this hardware. */
  source: VideoSource;
  resolution: Resolution;
  fps: Fps;
  flip: boolean;
  /** Bayer / YUV (visible), or IR-10 (infrared) */
  format: "bayer-8" | "yuv-16" | "ir-10";
  /** 1..50, only meaningful when source === "infrared" */
  irBrightness: number;
}

export type ColormapName =
  | "grayscale"
  | "jet"
  | "viridis"
  | "turbo"
  | "thermal"
  | "rainbow";

export type MotorLedName =
  | "OFF"
  | "GREEN"
  | "RED"
  | "AMBER"
  | "BLINK"
  | "BLINK_GREEN"
  | "BLINK_RED_AMBER";

export interface MotorTelemetry {
  servo: "IDLE" | "LIMIT" | "MOVING" | "UNKNOWN";
  rawAngle: number;
  angleDegrees?: number;
  accelG: [number, number, number];
}

/** Opaque handle returned by connect, used for cleanup. */
export interface KinectSession {
  stop(): Promise<void>;
}
