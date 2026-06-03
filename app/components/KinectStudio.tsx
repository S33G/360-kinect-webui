"use client";

/**
 * Kinect Studio — pro debug console for the Xbox 360 Kinect.
 *
 * Three-pane layout: device + stream + tools + skeleton on the left,
 * main canvas + skeleton preview in the center, telemetry + capture +
 * register debugger on the right.
 *
 * All Kinect hardware features exposed by @webnect/driver are controllable
 * here. Skeleton tracking is provided by two pluggable trackers
 * (heuristic + MediaPipe Pose).
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import styles from "./KinectStudio.module.css";
import {
  drawBlobOverlay,
  drawFrame,
  findNearestBlob,
} from "@/lib/kinect/canvas-renderer";
import {
  createBubbleGame,
  drawBubbleGame,
  tickBubbleGame,
  type BubbleGameState,
} from "@/lib/kinect/bubble-game";
import {
  createCursorState,
  drawCursor,
  updateCursor,
  type CursorState,
} from "@/lib/kinect/cursor-tracker";
import { KinectClient, isWebUsbSupported } from "@/lib/kinect/webusb";
import {
  drawSkeleton,
  drawSkeletonStandalone,
  DEFAULT_SKELETON_RENDER,
} from "@/lib/kinect/skeleton/skeleton-renderer";
import { TRACKERS } from "@/lib/kinect/skeleton/tracker-registry";
import type {
  Skeleton,
  SkeletonTracker,
} from "@/lib/kinect/skeleton/types";
import { ALL_JOINTS } from "@/lib/kinect/skeleton/types";
import type {
  ColormapName,
  DepthStreamConfig,
  KinectError,
  KinectStatus,
  MotorLedName,
  MotorTelemetry,
  PreviewMode,
  VideoStreamConfig,
} from "@/lib/kinect/types";

const CANVAS_W = 640;
const CANVAS_H = 480;

const STATUS_COLORS: Record<KinectStatus, string> = {
  idle: "#888",
  checking: "#f0ad4e",
  "requesting-device": "#f0ad4e",
  connecting: "#5bc0de",
  streaming: "#5cb85c",
  stopping: "#f0ad4e",
  error: "#d9534f",
};

const STATUS_LABELS: Record<KinectStatus, string> = {
  idle: "Disconnected",
  checking: "Checking…",
  "requesting-device": "Waiting for USB perm…",
  connecting: "Connecting…",
  streaming: "Streaming",
  stopping: "Stopping…",
  error: "Error",
};

const DEFAULT_DEPTH: DepthStreamConfig = {
  enabled: true,
  resolution: "VGA",
  fps: 30,
  flip: false,
  format: "11b",
};

const DEFAULT_VIDEO: VideoStreamConfig = {
  enabled: false,
  source: "visible",
  resolution: "VGA",
  fps: 30,
  flip: false,
  format: "bayer-8",
  irBrightness: 25,
};

const LED_OPTIONS: MotorLedName[] = [
  "OFF",
  "GREEN",
  "RED",
  "AMBER",
  "BLINK",
  "BLINK_GREEN",
  "BLINK_RED_AMBER",
];

const COLORMAPS: ColormapName[] = [
  "grayscale",
  "jet",
  "viridis",
  "turbo",
  "thermal",
  "rainbow",
];

const REGISTER_NAMES: Array<{ name: string; addr: number }> = [
  { name: "VIDEO_TYPE", addr: 5 },
  { name: "DEPTH_TYPE", addr: 6 },
  { name: "VISIBLE_FMT", addr: 12 },
  { name: "VISIBLE_RES", addr: 13 },
  { name: "VISIBLE_FPS", addr: 14 },
  { name: "DEPTH_FMT", addr: 18 },
  { name: "DEPTH_RES", addr: 19 },
  { name: "DEPTH_FPS", addr: 20 },
  { name: "INFRARED_BRIGHTNESS", addr: 21 },
  { name: "DEPTH_FLIP", addr: 23 },
  { name: "INFRARED_FMT", addr: 25 },
  { name: "INFRARED_RES", addr: 26 },
  { name: "INFRARED_FPS", addr: 27 },
  { name: "VISIBLE_FLIP", addr: 71 },
  { name: "INFRARED_FLIP", addr: 72 },
  { name: "PROJECTOR_CYCLE", addr: 261 },
];

// =====================================================================
// Collapsible Panel
// =====================================================================

function Panel({
  title,
  defaultOpen = true,
  storageKey,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  storageKey?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState<boolean>(() => {
    if (typeof window === "undefined" || !storageKey) return defaultOpen;
    const v = window.localStorage.getItem(`kstudio:panel:${storageKey}`);
    return v == null ? defaultOpen : v === "1";
  });
  useEffect(() => {
    if (storageKey)
      window.localStorage.setItem(
        `kstudio:panel:${storageKey}`,
        open ? "1" : "0",
      );
  }, [open, storageKey]);
  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader} onClick={() => setOpen((o) => !o)}>
        <span>{title}</span>
        <span
          className={`${styles.chevron} ${open ? styles.chevronOpen : ""}`}
        >
          ▶
        </span>
      </div>
      {open && <div className={styles.panelBody}>{children}</div>}
    </div>
  );
}

// =====================================================================
// Studio
// =====================================================================

export default function KinectStudio() {
  // ---- refs (don't trigger renders) ----
  const clientRef = useRef<KinectClient | null>(null);
  const mainCanvasRef = useRef<HTMLCanvasElement>(null);
  const skelCanvasRef = useRef<HTMLCanvasElement>(null);
  const bubbleGameRef = useRef<BubbleGameState | null>(null);
  const cursorRef = useRef<CursorState | null>(null);
  const trackerRef = useRef<SkeletonTracker | null>(null);
  const lastSkeletonRef = useRef<Skeleton | null>(null);
  const skelFrameCountRef = useRef(0);
  const frameLogRef = useRef<
    Array<{ t: number; fps: number; blob?: unknown; skel?: unknown }>
  >([]);
  const fpsCountRef = useRef(0);

  // ---- state ----
  const [supported] = useState<boolean | null>(() => {
    try {
      return isWebUsbSupported();
    } catch {
      return null;
    }
  });
  const [status, setStatus] = useState<KinectStatus>("idle");
  const [error, setError] = useState<KinectError | null>(null);
  const [fps, setFps] = useState(0);
  const [frameStats, setFrameStats] = useState({
    fps: 0,
    meanMs: 0,
    p95Ms: 0,
    maxMs: 0,
    dropped: 0,
  });

  const [depth, setDepth] = useState<DepthStreamConfig>(DEFAULT_DEPTH);
  const [video, setVideo] = useState<VideoStreamConfig>(DEFAULT_VIDEO);
  const [projectorOn, setProjectorOn] = useState(true);
  const [colormap, setColormap] = useState<ColormapName>("turbo");
  const [displaySource, setDisplaySource] = useState<"depth" | "video">("depth");

  const [previewMode, setPreviewMode] = useState<PreviewMode>("depth-preview");
  const [depthThreshold, setDepthThreshold] = useState(0.5);
  const [depthBand, setDepthBand] = useState(0.12);
  const [cursorSmoothing, setCursorSmoothing] = useState(0.15);

  const [motorAvailable, setMotorAvailable] = useState(false);
  const [motorTilt, setMotorTilt] = useState(0);
  const [motorLed, setMotorLed] = useState<MotorLedName>("GREEN");
  const [motorTelemetry, setMotorTelemetry] = useState<MotorTelemetry | null>(
    null,
  );

  const [trackerId, setTrackerId] = useState<string>("heuristic");
  const [trackerEveryN, setTrackerEveryN] = useState(1);
  const [skelShowJoints, setSkelShowJoints] = useState(true);
  const [skelShowBones, setSkelShowBones] = useState(true);
  const [skelShowLabels, setSkelShowLabels] = useState(false);
  const [skelConfidence, setSkelConfidence] = useState(0.15);
  const [skelOverlay, setSkelOverlay] = useState(true);
  const [skelSideBySide, setSkelSideBySide] = useState(true);
  const [trackerInitError, setTrackerInitError] = useState<string | null>(null);
  const [skeletonForUi, setSkeletonForUi] = useState<Skeleton | null>(null);
  const [frameLogLen, setFrameLogLen] = useState(0);

  const [recording, setRecording] = useState(false);
  const [registerAddr, setRegisterAddr] = useState(20);
  const [registerWrite, setRegisterWrite] = useState(30);
  const [registerLog, setRegisterLog] = useState<string>("");

  // ---- refs mirroring state (for the frame loop closure) ----
  const previewModeRef = useRef(previewMode);
  const depthThresholdRef = useRef(depthThreshold);
  const depthBandRef = useRef(depthBand);
  const colormapRef = useRef(colormap);
  const displaySourceRef = useRef(displaySource);
  const skelOptsRef = useRef({
    showJoints: skelShowJoints,
    showBones: skelShowBones,
    showLabels: skelShowLabels,
    confidence: skelConfidence,
    overlay: skelOverlay,
    sideBySide: skelSideBySide,
    everyN: trackerEveryN,
  });
  const recordingRef = useRef(false);
  const renderFrameRef = useRef<
    ((img: ImageData, kind: "depth" | "video") => void) | null
  >(null);

  useEffect(() => {
    previewModeRef.current = previewMode;
    if (previewMode !== "bubble-pop") bubbleGameRef.current = null;
    if (previewMode !== "cursor-mode") cursorRef.current = null;
  }, [previewMode]);
  useEffect(() => {
    depthThresholdRef.current = depthThreshold;
    if (cursorRef.current) cursorRef.current.depthThreshold = depthThreshold;
  }, [depthThreshold]);
  useEffect(() => {
    depthBandRef.current = depthBand;
  }, [depthBand]);
  useEffect(() => {
    colormapRef.current = colormap;
  }, [colormap]);
  useEffect(() => {
    displaySourceRef.current = displaySource;
  }, [displaySource]);
  useEffect(() => {
    skelOptsRef.current = {
      showJoints: skelShowJoints,
      showBones: skelShowBones,
      showLabels: skelShowLabels,
      confidence: skelConfidence,
      overlay: skelOverlay,
      sideBySide: skelSideBySide,
      everyN: trackerEveryN,
    };
  }, [
    skelShowJoints,
    skelShowBones,
    skelShowLabels,
    skelConfidence,
    skelOverlay,
    skelSideBySide,
    trackerEveryN,
  ]);
  useEffect(() => {
    recordingRef.current = recording;
  }, [recording]);

  // ---- FPS sampler ----
  useEffect(() => {
    const id = window.setInterval(() => {
      setFps(fpsCountRef.current);
      fpsCountRef.current = 0;
      const stats = clientRef.current?.getFrameStats();
      if (stats) setFrameStats(stats);
      // Mirror frequently-changing refs into state for the UI.
      setSkeletonForUi(lastSkeletonRef.current);
      setFrameLogLen(frameLogRef.current.length);
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  // ---- motor telemetry poller ----
  useEffect(() => {
    if (!motorAvailable) return;
    let cancelled = false;
    const tick = async () => {
      const t = await clientRef.current?.pollMotor();
      if (!cancelled) setMotorTelemetry(t ?? null);
    };
    tick();
    const id = window.setInterval(tick, 500);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [motorAvailable]);

  // ---- tracker lifecycle ----
  useEffect(() => {
    let cancelled = false;
    const entry = TRACKERS.find((t) => t.id === trackerId);
    if (!entry) return;
    trackerRef.current?.dispose();
    trackerRef.current = null;
    lastSkeletonRef.current = null;
    const instance = entry.factory();
    // Reset error asynchronously to satisfy the no-sync-setState-in-effect rule.
    queueMicrotask(() => {
      if (!cancelled) setTrackerInitError(null);
    });
    instance
      .init()
      .then(() => {
        if (cancelled) {
          instance.dispose();
          return;
        }
        trackerRef.current = instance;
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setTrackerInitError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
      instance.dispose();
    };
  }, [trackerId]);

  // ---- cleanup on unmount ----
  useEffect(() => {
    return () => {
      clientRef.current?.disconnect();
      trackerRef.current?.dispose();
    };
  }, []);

  // =====================================================================
  // Connect / Disconnect
  // =====================================================================

  const handleConnect = useCallback(async () => {
    setError(null);
    if (!isWebUsbSupported()) {
      setError({
        code: "WEBUSB_UNSUPPORTED",
        message: "WebUSB not available — use a Chromium-based browser.",
      });
      setStatus("error");
      return;
    }
    const client = new KinectClient((s, e) => {
      setStatus(s);
      if (e) setError(e);
    });
    clientRef.current = client;
    try {
      await client.connectCamera();
      await client.setStreams({ depth, video: video.enabled ? video : null });
      client.addFrameListener((img, kind) => {
        // Only render the active display source.
        if (kind !== displaySourceRef.current) return;
        renderFrameRef.current?.(img, kind);
      });
    } catch {
      /* errors surfaced via onStatus */
    }
  }, [depth, video]);

  const handleDisconnect = useCallback(async () => {
    setStatus("stopping");
    await clientRef.current?.disconnect();
    clientRef.current = null;
    setMotorAvailable(false);
    setMotorTelemetry(null);
    setStatus("idle");
  }, []);

  const handleConnectMotor = useCallback(async () => {
    if (!clientRef.current) return;
    try {
      await clientRef.current.connectMotor();
      setMotorAvailable(true);
    } catch {
      setMotorAvailable(false);
    }
  }, []);

  // =====================================================================
  // Apply stream config on the fly
  // =====================================================================

  const applyStreams = useCallback(async () => {
    if (!clientRef.current) return;
    try {
      await clientRef.current.setStreams({
        depth,
        video: video.enabled ? video : null,
      });
    } catch {
      /* surfaced via onStatus */
    }
  }, [depth, video]);

  // Toggle projector
  useEffect(() => {
    if (!clientRef.current || status !== "streaming") return;
    clientRef.current.setProjectorCycle(projectorOn).catch(() => {});
  }, [projectorOn, status]);

  // Motor tilt
  useEffect(() => {
    if (!motorAvailable) return;
    const t = setTimeout(() => {
      clientRef.current?.setMotorTilt(motorTilt).catch(() => {});
    }, 100);
    return () => clearTimeout(t);
  }, [motorTilt, motorAvailable]);

  // Motor LED
  useEffect(() => {
    if (!motorAvailable) return;
    clientRef.current?.setMotorLed(motorLed).catch(() => {});
  }, [motorLed, motorAvailable]);

  // =====================================================================
  // Per-frame render
  // =====================================================================

  const renderFrame = useCallback((img: ImageData, kind: "depth" | "video") => {
    fpsCountRef.current++;
    const canvas = mainCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const cmap = kind === "depth" ? colormapRef.current : "grayscale";
    const applyCmap = kind === "depth" && cmap !== "grayscale";
    drawFrame(ctx, img, cmap, applyCmap);

    const mode = previewModeRef.current;
    const thr = depthThresholdRef.current;
    const band = depthBandRef.current;

    // Blob-derived overlays only meaningful for depth.
    if (kind === "depth") {
      const blob = findNearestBlob(img, thr, band);

      if (mode === "blob-tracking" && blob) {
        drawBlobOverlay(ctx, blob);
      } else if (mode === "cursor-mode") {
        if (!cursorRef.current)
          cursorRef.current = createCursorState(thr, cursorSmoothing);
        cursorRef.current.smoothingFactor = cursorSmoothing;
        cursorRef.current = updateCursor(cursorRef.current, blob, CANVAS_W, CANVAS_H);
        drawCursor(ctx, cursorRef.current, CANVAS_W, CANVAS_H);
      } else if (mode === "bubble-pop") {
        if (!bubbleGameRef.current)
          bubbleGameRef.current = createBubbleGame(CANVAS_W, CANVAS_H);
        bubbleGameRef.current = tickBubbleGame(bubbleGameRef.current, blob);
        drawBubbleGame(ctx, bubbleGameRef.current, blob);
      }

      // Skeleton tracking (regardless of preview mode, if skeleton mode picked
      // OR side-by-side toggle on).
      const skelOpts = skelOptsRef.current;
      const wantSkeleton =
        mode === "skeleton" || skelOpts.overlay || skelOpts.sideBySide;
      if (wantSkeleton && trackerRef.current) {
        skelFrameCountRef.current++;
        if (skelFrameCountRef.current % Math.max(1, skelOpts.everyN) === 0) {
          const result = trackerRef.current.process(img);
          if (result instanceof Promise) {
            result
              .then((s) => {
                if (s) lastSkeletonRef.current = s;
              })
              .catch(() => {});
          } else if (result) {
            lastSkeletonRef.current = result;
          }
        }
        if (lastSkeletonRef.current && skelOpts.overlay && (mode === "skeleton" || mode === "depth-preview" || mode === "none")) {
          drawSkeleton(ctx, lastSkeletonRef.current, {
            showJoints: skelOpts.showJoints,
            showBones: skelOpts.showBones,
            showLabels: skelOpts.showLabels,
            confidenceFilter: skelOpts.confidence,
          });
        }
      }

      // Side-by-side skeleton render
      if (skelOpts.sideBySide && skelCanvasRef.current) {
        const sctx = skelCanvasRef.current.getContext("2d");
        if (sctx) {
          const w = skelCanvasRef.current.width;
          const h = skelCanvasRef.current.height;
          // Scale skeleton coords from CANVAS_W/H to standalone canvas dims
          let scaled: Skeleton | null = null;
          if (lastSkeletonRef.current) {
            const sx = w / CANVAS_W;
            const sy = h / CANVAS_H;
            scaled = {
              ...lastSkeletonRef.current,
              joints: Object.fromEntries(
                Object.entries(lastSkeletonRef.current.joints).map(
                  ([k, j]) => [
                    k,
                    j
                      ? { ...j, x: j.x * sx, y: j.y * sy }
                      : j,
                  ],
                ),
              ),
            };
          }
          drawSkeletonStandalone(sctx, scaled, w, h, {
            showJoints: skelOpts.showJoints,
            showBones: skelOpts.showBones,
            showLabels: skelOpts.showLabels,
            confidenceFilter: skelOpts.confidence,
          });
        }
      }

      // Record frame log
      if (recordingRef.current) {
        frameLogRef.current.push({
          t: performance.now(),
          fps: fpsCountRef.current,
          blob: blob
            ? { x: blob.cx, y: blob.cy, peak: blob.peakDepth, n: blob.pixelCount }
            : undefined,
          skel: lastSkeletonRef.current
            ? Object.fromEntries(
                Object.entries(lastSkeletonRef.current.joints).map(
                  ([k, j]) => [
                    k,
                    j
                      ? [Math.round(j.x), Math.round(j.y), +j.confidence.toFixed(2)]
                      : null,
                  ],
                ),
              )
            : undefined,
        });
        if (frameLogRef.current.length > 5000)
          frameLogRef.current.shift();
      }
    }
  }, [cursorSmoothing]);

  useEffect(() => {
    renderFrameRef.current = renderFrame;
  }, [renderFrame]);

  // =====================================================================
  // Capture
  // =====================================================================

  const downloadSnapshot = useCallback(() => {
    const canvas = mainCanvasRef.current;
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      a.href = url;
      a.download = `kinect-${ts}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, "image/png");
  }, []);

  const downloadFrameLog = useCallback(() => {
    const blob = new Blob([JSON.stringify(frameLogRef.current, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    a.href = url;
    a.download = `kinect-log-${ts}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, []);

  const toggleRecording = useCallback(() => {
    if (recording) {
      setRecording(false);
    } else {
      frameLogRef.current = [];
      setRecording(true);
    }
  }, [recording]);

  // =====================================================================
  // Register debug
  // =====================================================================

  const appendRegLog = (line: string) =>
    setRegisterLog((p) =>
      (p ? p + "\n" : "") +
      `[${new Date().toLocaleTimeString()}] ${line}`,
    );

  const handleReadRegister = useCallback(async () => {
    if (!clientRef.current) return;
    try {
      const v = await clientRef.current.readRegister(registerAddr);
      appendRegLog(
        `READ  0x${registerAddr.toString(16).padStart(4, "0")} = ${v} (0x${(v as number).toString(16)})`,
      );
    } catch (e) {
      appendRegLog(
        `READ  0x${registerAddr.toString(16).padStart(4, "0")} FAILED: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }, [registerAddr]);

  const handleWriteRegister = useCallback(async () => {
    if (!clientRef.current) return;
    try {
      await clientRef.current.writeRegister(registerAddr, registerWrite);
      appendRegLog(
        `WRITE 0x${registerAddr.toString(16).padStart(4, "0")} <= ${registerWrite}`,
      );
    } catch (e) {
      appendRegLog(
        `WRITE 0x${registerAddr.toString(16).padStart(4, "0")} FAILED: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }, [registerAddr, registerWrite]);

  const handleDumpRegisters = useCallback(async () => {
    if (!clientRef.current) return;
    for (const r of REGISTER_NAMES) {
      try {
        const v = await clientRef.current.readRegister(r.addr);
        appendRegLog(`${r.name.padEnd(20)} (0x${r.addr.toString(16)}) = ${v}`);
      } catch (e) {
        appendRegLog(
          `${r.name.padEnd(20)} (0x${r.addr.toString(16)}) FAILED: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  }, []);

  // =====================================================================
  // Render
  // =====================================================================

  const isConnected = status === "streaming";
  const isConnecting =
    status === "checking" ||
    status === "requesting-device" ||
    status === "connecting";

  const skeletonJointCount = useMemo(() => {
    if (!skeletonForUi) return 0;
    return Object.values(skeletonForUi.joints).filter(
      (j) => j && j.confidence >= skelConfidence,
    ).length;
  }, [skelConfidence, skeletonForUi]);

  return (
    <div className={styles.studio}>
      {/* HEADER */}
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Kinect Studio</h1>
          <div className={styles.subtitle}>
            Xbox 360 Kinect · WebUSB R&D Console
          </div>
        </div>
        <span
          className={styles.statusDot}
          style={{ background: STATUS_COLORS[status] }}
        />
        <span className={styles.statusText}>{STATUS_LABELS[status]}</span>
        {isConnected && (
          <>
            <span className={styles.fps}>
              {fps} fps · {frameStats.meanMs.toFixed(1)}ms mean
            </span>
          </>
        )}
        {!isConnected && !isConnecting && (
          <button
            className={styles.connectBtn}
            onClick={handleConnect}
            disabled={supported === false}
          >
            Connect Kinect
          </button>
        )}
        {isConnecting && (
          <button className={styles.connectBtn} disabled>
            Connecting…
          </button>
        )}
        {isConnected && (
          <button className={styles.disconnectBtn} onClick={handleDisconnect}>
            Disconnect
          </button>
        )}
      </header>

      {/* LEFT PANE */}
      <aside className={styles.left}>
        {supported === false && (
          <div className={styles.warning}>
            WebUSB unsupported. Use Chrome/Edge/Brave.
          </div>
        )}
        {error && (
          <div className={styles.error}>
            <strong>[{error.code}]</strong> {error.message}
          </div>
        )}

        {/* Device */}
        <Panel title="Device & Motor" storageKey="device">
          <div className={styles.row}>
            <span className={styles.label}>Motor</span>
            {motorAvailable ? (
              <span className={`${styles.value} ${styles.valueGood}`}>
                connected
              </span>
            ) : (
              <button
                className={styles.btn}
                onClick={handleConnectMotor}
                disabled={!isConnected}
              >
                Claim motor USB
              </button>
            )}
          </div>
          <div className={styles.row}>
            <span className={styles.label}>Tilt</span>
            <input
              type="range"
              min={-30}
              max={30}
              value={motorTilt}
              onChange={(e) => setMotorTilt(parseInt(e.target.value, 10))}
              disabled={!motorAvailable}
              className={styles.slider}
            />
            <span className={styles.value}>{motorTilt}°</span>
          </div>
          <div className={styles.row}>
            <span className={styles.label}>LED</span>
            <select
              className={styles.select}
              value={motorLed}
              onChange={(e) => setMotorLed(e.target.value as MotorLedName)}
              disabled={!motorAvailable}
            >
              {LED_OPTIONS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.row}>
            <span className={styles.label}>IR Projector</span>
            <input
              type="checkbox"
              className={styles.checkbox}
              checked={projectorOn}
              onChange={(e) => setProjectorOn(e.target.checked)}
              disabled={!isConnected}
            />
            <span className={styles.value}>
              {projectorOn ? "cycling" : "off"}
            </span>
          </div>
          <div className={styles.smallNote}>
            Motor USB requires a separate permission prompt.
          </div>
        </Panel>

        {/* Streams */}
        <Panel title="Streams" storageKey="streams">
          <div className={styles.row}>
            <span className={styles.label}>Display</span>
            <div className={styles.toggleRow}>
              {(["depth", "video"] as const).map((s) => (
                <button
                  key={s}
                  className={`${styles.toggle} ${displaySource === s ? styles.toggleActive : ""}`}
                  onClick={() => setDisplaySource(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
          <div className={styles.row}>
            <span className={styles.label}>Colormap</span>
            <select
              className={styles.select}
              value={colormap}
              onChange={(e) => setColormap(e.target.value as ColormapName)}
            >
              {COLORMAPS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          {/* DEPTH */}
          <div style={{ marginTop: 8, fontSize: 11, color: "#5cb85c" }}>
            DEPTH
          </div>
          <ConfigToggleRow
            label="Enabled"
            checked={depth.enabled}
            onChange={(b) => setDepth({ ...depth, enabled: b })}
          />
          <SelectRow
            label="Resolution"
            value={depth.resolution}
            options={["QVGA", "VGA", "SXGA"]}
            onChange={(v) =>
              setDepth({ ...depth, resolution: v as DepthStreamConfig["resolution"] })
            }
          />
          <SelectRow
            label="FPS"
            value={String(depth.fps)}
            options={["15", "30"]}
            onChange={(v) =>
              setDepth({ ...depth, fps: parseInt(v, 10) as 15 | 30 })
            }
          />
          <SelectRow
            label="Bit Depth"
            value={depth.format}
            options={["10b", "11b"]}
            onChange={(v) =>
              setDepth({ ...depth, format: v as "10b" | "11b" })
            }
          />
          <ConfigToggleRow
            label="Flip"
            checked={depth.flip}
            onChange={(b) => setDepth({ ...depth, flip: b })}
          />

          {/* VIDEO */}
          <div style={{ marginTop: 8, fontSize: 11, color: "#5cb85c" }}>
            VIDEO
          </div>
          <ConfigToggleRow
            label="Enabled"
            checked={video.enabled}
            onChange={(b) => setVideo({ ...video, enabled: b })}
          />
          <SelectRow
            label="Source"
            value={video.source}
            options={["visible", "infrared"]}
            onChange={(v) => {
              const src = v as VideoStreamConfig["source"];
              setVideo({
                ...video,
                source: src,
                format: src === "visible" ? "bayer-8" : "ir-10",
              });
            }}
          />
          <SelectRow
            label="Resolution"
            value={video.resolution}
            options={["QVGA", "VGA", "SXGA"]}
            onChange={(v) =>
              setVideo({
                ...video,
                resolution: v as VideoStreamConfig["resolution"],
              })
            }
          />
          <SelectRow
            label="FPS"
            value={String(video.fps)}
            options={["15", "30"]}
            onChange={(v) =>
              setVideo({ ...video, fps: parseInt(v, 10) as 15 | 30 })
            }
          />
          {video.source === "visible" ? (
            <SelectRow
              label="Format"
              value={video.format}
              options={["bayer-8", "yuv-16"]}
              onChange={(v) =>
                setVideo({
                  ...video,
                  format: v as "bayer-8" | "yuv-16" | "ir-10",
                })
              }
            />
          ) : (
            <div className={styles.row}>
              <span className={styles.label}>IR Brightness</span>
              <input
                type="range"
                min={1}
                max={50}
                value={video.irBrightness}
                onChange={(e) =>
                  setVideo({
                    ...video,
                    irBrightness: parseInt(e.target.value, 10),
                  })
                }
                className={styles.slider}
              />
              <span className={styles.value}>{video.irBrightness}</span>
            </div>
          )}
          <ConfigToggleRow
            label="Flip"
            checked={video.flip}
            onChange={(b) => setVideo({ ...video, flip: b })}
          />

          <button
            className={styles.btnAccent}
            onClick={applyStreams}
            disabled={!isConnected}
            style={{ marginTop: 8 }}
          >
            Apply stream config
          </button>
          <div className={styles.smallNote}>
            Visible and infrared share the video pipe — only one can stream at a
            time.
          </div>
        </Panel>

        {/* Tools */}
        <Panel title="Tools / Preview Mode" storageKey="tools">
          <div className={styles.toggleRow}>
            {(
              [
                "depth-preview",
                "blob-tracking",
                "cursor-mode",
                "bubble-pop",
                "skeleton",
                "none",
              ] as PreviewMode[]
            ).map((m) => (
              <button
                key={m}
                className={`${styles.toggle} ${previewMode === m ? styles.toggleActive : ""}`}
                onClick={() => setPreviewMode(m)}
              >
                {m}
              </button>
            ))}
          </div>
          <SliderRow
            label="Depth Threshold"
            min={0.05}
            max={0.95}
            step={0.02}
            value={depthThreshold}
            onChange={setDepthThreshold}
          />
          <SliderRow
            label="Depth Band"
            min={0.02}
            max={0.5}
            step={0.02}
            value={depthBand}
            onChange={setDepthBand}
          />
          <SliderRow
            label="Cursor Smoothing"
            min={0.05}
            max={0.6}
            step={0.05}
            value={cursorSmoothing}
            onChange={setCursorSmoothing}
          />
        </Panel>

        {/* Skeleton */}
        <Panel title="Skeleton Tracker" storageKey="skel">
          <SelectRow
            label="Tracker"
            value={trackerId}
            options={TRACKERS.map((t) => t.id)}
            onChange={setTrackerId}
          />
          <div className={styles.smallNote}>
            {TRACKERS.find((t) => t.id === trackerId)?.description}
          </div>
          {trackerInitError && (
            <div className={styles.error}>{trackerInitError}</div>
          )}
          <ConfigToggleRow
            label="Overlay on depth"
            checked={skelOverlay}
            onChange={setSkelOverlay}
          />
          <ConfigToggleRow
            label="Side-by-side view"
            checked={skelSideBySide}
            onChange={setSkelSideBySide}
          />
          <ConfigToggleRow
            label="Show joints"
            checked={skelShowJoints}
            onChange={setSkelShowJoints}
          />
          <ConfigToggleRow
            label="Show bones"
            checked={skelShowBones}
            onChange={setSkelShowBones}
          />
          <ConfigToggleRow
            label="Show labels"
            checked={skelShowLabels}
            onChange={setSkelShowLabels}
          />
          <SliderRow
            label="Confidence ≥"
            min={0}
            max={1}
            step={0.05}
            value={skelConfidence}
            onChange={setSkelConfidence}
          />
          <SliderRow
            label="Process every N frames"
            min={1}
            max={10}
            step={1}
            value={trackerEveryN}
            onChange={(v) => setTrackerEveryN(Math.round(v))}
            display={(v) => `${v}`}
          />
        </Panel>
      </aside>

      {/* CENTER */}
      <section className={styles.center}>
        <div className={styles.canvasWrap}>
          <canvas
            ref={mainCanvasRef}
            width={CANVAS_W}
            height={CANVAS_H}
          />
          {!isConnected && status !== "error" && (
            <div className={styles.canvasOverlay}>
              {isConnecting ? (
                <span>Connecting…</span>
              ) : (
                <span>
                  Plug in the Kinect (USB + power adapter) and click
                  <br />
                  <strong style={{ color: "#5cb85c" }}>
                    Connect Kinect
                  </strong>{" "}
                  in the header.
                </span>
              )}
            </div>
          )}
        </div>
        {skelSideBySide && (
          <div className={styles.skeletonStandalone}>
            <canvas ref={skelCanvasRef} width={640} height={220} />
          </div>
        )}
      </section>

      {/* RIGHT PANE */}
      <aside className={styles.right}>
        {/* Telemetry */}
        <Panel title="Telemetry" storageKey="telem">
          <div className={styles.row}>
            <span className={styles.label}>FPS</span>
            <span className={`${styles.value} ${styles.valueGood}`}>
              {frameStats.fps}
            </span>
          </div>
          <div className={styles.row}>
            <span className={styles.label}>Mean Δt</span>
            <span className={styles.value}>{frameStats.meanMs.toFixed(1)} ms</span>
          </div>
          <div className={styles.row}>
            <span className={styles.label}>p95 Δt</span>
            <span className={styles.value}>{frameStats.p95Ms.toFixed(1)} ms</span>
          </div>
          <div className={styles.row}>
            <span className={styles.label}>Max Δt</span>
            <span className={styles.value}>{frameStats.maxMs.toFixed(1)} ms</span>
          </div>
          <div className={styles.row}>
            <span className={styles.label}>Dropped</span>
            <span className={styles.value}>{frameStats.dropped}</span>
          </div>
          <div style={{ height: 6 }} />
          <div className={styles.row}>
            <span className={styles.label}>Servo</span>
            <span className={styles.value}>
              {motorTelemetry?.servo ?? "—"}
            </span>
          </div>
          <div className={styles.row}>
            <span className={styles.label}>Angle</span>
            <span className={styles.value}>
              {motorTelemetry?.angleDegrees != null
                ? `${motorTelemetry.angleDegrees.toFixed(1)}°`
                : "—"}
            </span>
          </div>
          {(["X", "Y", "Z"] as const).map((axis, i) => (
            <div className={styles.row} key={axis}>
              <span className={styles.label}>Accel {axis}</span>
              <AccelBar v={motorTelemetry?.accelG?.[i] ?? 0} />
              <span className={styles.value}>
                {motorTelemetry ? motorTelemetry.accelG[i].toFixed(2) : "—"} g
              </span>
            </div>
          ))}
        </Panel>

        {/* Skeleton readout */}
        <Panel title="Skeleton readout" storageKey="skelread">
          <div className={styles.row}>
            <span className={styles.label}>Detected joints</span>
            <span className={`${styles.value} ${styles.valueGood}`}>
              {skeletonJointCount}/{ALL_JOINTS.length}
            </span>
          </div>
          <div className={styles.jointList}>
            {ALL_JOINTS.map((name) => {
              const j = skeletonForUi?.joints[name];
              return (
                <div key={name}>
                  {name}: {j ? j.confidence.toFixed(2) : "—"}
                </div>
              );
            })}
          </div>
        </Panel>

        {/* Capture */}
        <Panel title="Capture" storageKey="capture">
          <button className={styles.btn} onClick={downloadSnapshot}>
            Snapshot PNG
          </button>
          <button
            className={recording ? styles.btnDanger : styles.btnAccent}
            onClick={toggleRecording}
            disabled={!isConnected}
          >
            {recording
              ? `■ Stop log (${frameLogLen} frames)`
              : "● Start frame log"}
          </button>
          <button
            className={styles.btn}
            onClick={downloadFrameLog}
            disabled={frameLogLen === 0}
          >
            Download log JSON
          </button>
          <div className={styles.smallNote}>
            Log captures FPS, blob centroid, and skeleton joint positions per
            frame.
          </div>
        </Panel>

        {/* Register Debug */}
        <Panel title="Register Debugger" defaultOpen={false} storageKey="reg">
          <SelectRow
            label="Register"
            value={String(registerAddr)}
            options={REGISTER_NAMES.map((r) => String(r.addr))}
            renderOption={(v) => {
              const r = REGISTER_NAMES.find((x) => String(x.addr) === v);
              return r ? `${r.name} (0x${r.addr.toString(16)})` : v;
            }}
            onChange={(v) => setRegisterAddr(parseInt(v, 10))}
          />
          <div className={styles.row}>
            <span className={styles.label}>Custom addr</span>
            <input
              type="number"
              className={styles.input}
              value={registerAddr}
              onChange={(e) => setRegisterAddr(parseInt(e.target.value, 10) || 0)}
            />
          </div>
          <div className={styles.row}>
            <span className={styles.label}>Write value</span>
            <input
              type="number"
              className={styles.input}
              value={registerWrite}
              onChange={(e) =>
                setRegisterWrite(parseInt(e.target.value, 10) || 0)
              }
            />
          </div>
          <div className={styles.toggleRow}>
            <button
              className={styles.btn}
              onClick={handleReadRegister}
              disabled={!isConnected}
            >
              Read
            </button>
            <button
              className={styles.btn}
              onClick={handleWriteRegister}
              disabled={!isConnected}
            >
              Write
            </button>
            <button
              className={styles.btn}
              onClick={handleDumpRegisters}
              disabled={!isConnected}
            >
              Dump all
            </button>
            <button
              className={styles.btn}
              onClick={() => setRegisterLog("")}
            >
              Clear log
            </button>
          </div>
          <div className={styles.codeBlock}>
            {registerLog || "// register log empty"}
          </div>
        </Panel>
      </aside>
    </div>
  );
}

// =====================================================================
// Small subcomponents
// =====================================================================

function ConfigToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className={styles.row}>
      <span className={styles.label}>{label}</span>
      <input
        type="checkbox"
        className={styles.checkbox}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </div>
  );
}

function SelectRow({
  label,
  value,
  options,
  onChange,
  renderOption,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
  renderOption?: (v: string) => string;
}) {
  return (
    <div className={styles.row}>
      <span className={styles.label}>{label}</span>
      <select
        className={styles.select}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {renderOption ? renderOption(o) : o}
          </option>
        ))}
      </select>
    </div>
  );
}

function SliderRow({
  label,
  min,
  max,
  step,
  value,
  onChange,
  display,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  display?: (v: number) => string;
}) {
  return (
    <div className={styles.row}>
      <span className={styles.label}>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className={styles.slider}
      />
      <span className={styles.value}>
        {display ? display(value) : value.toFixed(2)}
      </span>
    </div>
  );
}

function AccelBar({ v }: { v: number }) {
  // map -2..2 g -> 0..100%
  const pct = Math.max(0, Math.min(100, ((v + 2) / 4) * 100));
  const style: CSSProperties = { width: `${pct}%` };
  return (
    <div className={styles.bar}>
      <div className={styles.barFill} style={style} />
    </div>
  );
}

// Suppress unused exports warning in some configs
void DEFAULT_SKELETON_RENDER;
