/**
 * WebUSB Kinect client. Wraps @webnect/driver Camera + Motor.
 *
 * MUST only be imported from client code (uses navigator.usb).
 */

import type {
  DepthStreamConfig,
  KinectError,
  KinectSession,
  KinectStatus,
  MotorLedName,
  MotorTelemetry,
  VideoStreamConfig,
} from "./types";

export function isWebUsbSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof navigator !== "undefined" &&
    "usb" in navigator
  );
}

type DriverModule = typeof import("@webnect/driver");

export type FrameListener = (
  imageData: ImageData,
  kind: "depth" | "video",
) => void;

export type StatusListener = (
  status: KinectStatus,
  error?: KinectError,
) => void;

interface ActiveStreams {
  depth?: ImageData;
  video?: ImageData;
}

const LED_MAP: Record<MotorLedName, number> = {
  OFF: 0,
  GREEN: 1,
  RED: 2,
  AMBER: 3,
  BLINK: 4,
  BLINK_GREEN: 5,
  BLINK_RED_AMBER: 6,
};

export class KinectClient {
  private driver: DriverModule | null = null;
  private camDevice: USBDevice | null = null;
  private motorDevice: USBDevice | null = null;
  private camera: InstanceType<DriverModule["Camera"]> | null = null;
  private motor: InstanceType<DriverModule["Motor"]> | null = null;
  private streams: ActiveStreams = {};
  private frameListeners = new Set<FrameListener>();
  private rafId = 0;
  private running = false;
  private frameTimestamps: number[] = [];
  private droppedFrames = 0;

  constructor(private readonly onStatus: StatusListener) {}

  // ---- connection ----

  async connectCamera(): Promise<void> {
    if (!isWebUsbSupported()) {
      this.onStatus("error", {
        code: "WEBUSB_UNSUPPORTED",
        message:
          "WebUSB is not available. Use a Chromium-based browser (Chrome, Edge).",
      });
      throw new Error("WebUSB unsupported");
    }

    this.driver = await import("@webnect/driver");
    this.onStatus("requesting-device");

    try {
      this.camDevice = await this.driver.claimNuiCamera();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      let code: KinectError["code"] = "NO_DEVICE";
      if (msg.includes("denied") || msg.includes("NotAllowedError"))
        code = "PERMISSION_DENIED";
      this.onStatus("error", { code, message: `Camera claim failed: ${msg}` });
      throw err;
    }

    this.onStatus("connecting");
    try {
      this.camera = new this.driver.Camera(this.camDevice);
      await this.camera.ready;
    } catch (err: unknown) {
      this.onStatus("error", {
        code: "CONNECT_FAILED",
        message: `Camera init failed: ${err instanceof Error ? err.message : String(err)}`,
      });
      throw err;
    }
  }

  async connectMotor(): Promise<void> {
    if (!this.driver) this.driver = await import("@webnect/driver");
    try {
      this.motorDevice = await this.driver.claimNuiMotor();
      this.motor = new this.driver.Motor(this.motorDevice);
      await this.motor.ready;
    } catch (err: unknown) {
      this.motorDevice = null;
      this.motor = null;
      this.onStatus("error", {
        code: "MOTOR_UNAVAILABLE",
        message: `Motor claim failed: ${err instanceof Error ? err.message : String(err)}`,
      });
      throw err;
    }
  }

  isMotorConnected(): boolean {
    return !!this.motor;
  }

  // ---- streams ----

  /**
   * Configure depth and/or video streams.
   * Video stream can be visible RGB or infrared (mutually exclusive on hw).
   * Pass `null` for a stream to disable it.
   */
  async setStreams(opts: {
    depth: DepthStreamConfig | null;
    video: VideoStreamConfig | null;
  }): Promise<void> {
    if (!this.camera || !this.driver) throw new Error("Camera not connected");
    const d = this.driver;

    const resMap = {
      QVGA: d.CamRes.QVGA,
      VGA: d.CamRes.VGA,
      SXGA: d.CamRes.SXGA,
    } as const;

    const config: { depth?: unknown; video?: unknown } = {};

    if (opts.depth?.enabled) {
      const mode = {
        stream: d.Cam.DEPTH,
        format:
          opts.depth.format === "11b" ? d.CamFmtDepth.D_11B : d.CamFmtDepth.D_10B,
        res: resMap[opts.depth.resolution],
        fps: opts.depth.fps,
        flip: opts.depth.flip,
      };
      (config as { depth: unknown }).depth = mode;
    }

    if (opts.video?.enabled) {
      const v = opts.video;
      if (v.source === "visible") {
        const fmt =
          v.format === "yuv-16"
            ? d.CamFmtVisible.YUV_16B
            : d.CamFmtVisible.BAYER_8B;
        (config as { video: unknown }).video = {
          stream: d.Cam.VISIBLE,
          format: fmt,
          res: resMap[v.resolution],
          fps: v.fps,
          flip: v.flip,
        };
      } else {
        (config as { video: unknown }).video = {
          stream: d.Cam.INFRARED,
          format: d.CamFmtInfrared.IR_10B,
          res: resMap[v.resolution],
          fps: v.fps,
          flip: v.flip,
        };
        // Apply IR brightness
        try {
          await this.camera.writeRegister(
            d.CamRegister.INFRARED_BRIGHTNESS,
            v.irBrightness,
          );
        } catch {
          /* IR brightness is best-effort */
        }
      }
    }

    try {
      // setMode returns the live CamImageData objects
      const result = (await this.camera.setMode(
        config as Parameters<typeof this.camera.setMode>[0],
      )) as { depth?: ImageData; video?: ImageData };
      this.streams = {
        depth: result.depth,
        video: result.video,
      };
    } catch (err: unknown) {
      this.onStatus("error", {
        code: "STREAM_FAILED",
        message: `setMode failed: ${err instanceof Error ? err.message : String(err)}`,
      });
      throw err;
    }

    if (!this.running) this.startLoop();
    this.onStatus("streaming");
  }

  getStreams(): ActiveStreams {
    return this.streams;
  }

  // ---- frame loop ----

  private startLoop(): void {
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      const now = performance.now();
      this.frameTimestamps.push(now);
      if (this.frameTimestamps.length > 120) this.frameTimestamps.shift();

      for (const fn of this.frameListeners) {
        try {
          if (this.streams.depth) fn(this.streams.depth, "depth");
          if (this.streams.video) fn(this.streams.video, "video");
        } catch {
          this.droppedFrames++;
        }
      }
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  addFrameListener(fn: FrameListener): () => void {
    this.frameListeners.add(fn);
    return () => this.frameListeners.delete(fn);
  }

  getFrameStats(): { fps: number; meanMs: number; p95Ms: number; maxMs: number; dropped: number } {
    const t = this.frameTimestamps;
    if (t.length < 2)
      return { fps: 0, meanMs: 0, p95Ms: 0, maxMs: 0, dropped: this.droppedFrames };
    const intervals: number[] = [];
    for (let i = 1; i < t.length; i++) intervals.push(t[i] - t[i - 1]);
    intervals.sort((a, b) => a - b);
    const mean = intervals.reduce((s, x) => s + x, 0) / intervals.length;
    const p95 = intervals[Math.floor(intervals.length * 0.95)] ?? mean;
    const max = intervals[intervals.length - 1];
    const fps = 1000 / mean;
    return {
      fps: Math.round(fps * 10) / 10,
      meanMs: Math.round(mean * 10) / 10,
      p95Ms: Math.round(p95 * 10) / 10,
      maxMs: Math.round(max * 10) / 10,
      dropped: this.droppedFrames,
    };
  }

  // ---- registers ----

  async readRegister(addr: number): Promise<number> {
    if (!this.camera) throw new Error("Camera not connected");
    try {
      return (await this.camera.readRegister(
        addr as unknown as never,
      )) as unknown as number;
    } catch (err: unknown) {
      throw new Error(
        `readRegister(${addr}) failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async writeRegister(addr: number, value: number): Promise<void> {
    if (!this.camera) throw new Error("Camera not connected");
    try {
      await this.camera.writeRegister(
        addr as unknown as never,
        value as unknown as never,
      );
    } catch (err: unknown) {
      throw new Error(
        `writeRegister(${addr}, ${value}) failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async setProjectorCycle(on: boolean): Promise<void> {
    if (!this.driver) return;
    await this.writeRegister(this.driver.CamRegister.PROJECTOR_CYCLE, on ? 1 : 0);
  }

  async setIrBrightness(brightness: number): Promise<void> {
    if (!this.driver) return;
    const b = Math.max(1, Math.min(50, brightness | 0));
    await this.writeRegister(this.driver.CamRegister.INFRARED_BRIGHTNESS, b);
  }

  // ---- motor ----

  async setMotorTilt(deg: number): Promise<void> {
    if (!this.motor) throw new Error("Motor not connected");
    const clamped = Math.max(-30, Math.min(30, deg));
    await this.motor.setPosition(clamped);
  }

  async setMotorLed(led: MotorLedName): Promise<void> {
    if (!this.motor || !this.driver) throw new Error("Motor not connected");
    await this.motor.setLed(LED_MAP[led] as unknown as never);
  }

  async pollMotor(): Promise<MotorTelemetry | null> {
    if (!this.motor) return null;
    try {
      const s = await this.motor.getPosition();
      const servoMap: Record<number, MotorTelemetry["servo"]> = {
        0: "IDLE",
        1: "LIMIT",
        4: "MOVING",
      };
      return {
        servo: servoMap[s.servo as unknown as number] ?? "UNKNOWN",
        rawAngle: s.rawAngle,
        angleDegrees: s.angleDegrees,
        accelG: s.accelG,
      };
    } catch {
      return null;
    }
  }

  // ---- teardown ----

  async disconnect(): Promise<void> {
    this.running = false;
    cancelAnimationFrame(this.rafId);
    this.frameListeners.clear();
    try {
      if (this.camera && this.driver) {
        await this.camera.streamDepth(undefined as never);
      }
    } catch {
      /* ignore */
    }
    try {
      await this.camDevice?.close();
    } catch {
      /* ignore */
    }
    try {
      await this.motorDevice?.close();
    } catch {
      /* ignore */
    }
    this.camDevice = null;
    this.motorDevice = null;
    this.camera = null;
    this.motor = null;
    this.streams = {};
  }

  toSession(): KinectSession {
    return {
      stop: () => this.disconnect(),
    };
  }
}

/** Back-compat helper used by old code paths. */
export async function connectAndStreamDepth(
  onFrame: (imageData: ImageData) => void,
  onStatus: StatusListener,
): Promise<KinectSession> {
  const client = new KinectClient(onStatus);
  try {
    await client.connectCamera();
    await client.setStreams({
      depth: {
        enabled: true,
        resolution: "VGA",
        fps: 30,
        flip: false,
        format: "11b",
      },
      video: null,
    });
    client.addFrameListener((img, kind) => {
      if (kind === "depth") onFrame(img);
    });
  } catch {
    return { stop: async () => {} };
  }
  return client.toSession();
}
