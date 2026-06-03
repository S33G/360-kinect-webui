# Xbox 360 Kinect Web R&D — Kinect Studio

Local Next.js prototype that connects to an **original Xbox 360 Kinect** via WebUSB and streams depth / IR / visible data into a browser canvas. Ships **Kinect Studio**, a pro debug console exposing every controllable feature of the device plus pluggable skeleton tracking.

## Prerequisites

- **Node.js** 20.9+
- **Chromium-based browser** (Chrome, Edge, Brave, etc.) — WebUSB is not available in Safari or Firefox
- **Original Xbox 360 Kinect** (model 1414) — NOT Kinect v2
- **Kinect USB + power adapter** (the combo cable that splits into USB + wall power)

## Install

```bash
npm install
```

## Run

```bash
npm run dev
```

Open **http://localhost:3000** in Chrome/Chromium.

## Usage

1. Plug in the Xbox 360 Kinect (USB + power adapter).
2. Open the app in Chrome.
3. Click **Connect Kinect**.
4. A browser permission dialog will appear — select your Kinect device.
5. If successful, live depth frames will render on the canvas.

### Studio Panels

**Left pane**
- **Device & Motor** — connect camera & motor (separate USB perm), tilt slider (-30°…+30°), LED color picker (7 states), IR projector cycle toggle
- **Streams** — depth + video (visible/infrared) independent control: enable, resolution (QVGA/VGA/SXGA), FPS (15/30), bit depth (10b/11b), format (Bayer/YUV/IR), flip, IR brightness (1–50), depth colormap (grayscale/jet/viridis/turbo/thermal/rainbow)
- **Tools / Preview Mode** — depth preview, blob tracking, smoothed cursor, bubble-pop game, skeleton, none; depth threshold + depth band + cursor smoothing sliders
- **Skeleton Tracker** — pluggable trackers: Heuristic (depth-only geometric) or MediaPipe Pose (33-landmark ML); overlay/side-by-side toggles; joint/bone/label visibility; confidence filter; process-every-N-frames

**Center**
- Main canvas with composited overlays
- Side-by-side standalone skeleton canvas

**Right pane**
- **Telemetry** — live FPS, mean/p95/max frame Δt, dropped frames, servo state, motor angle, three-axis accelerometer with bar visualization
- **Skeleton readout** — detected joint count + per-joint confidence
- **Capture** — snapshot PNG of canvas (with overlays), frame-log recorder (start/stop, JSON download with FPS + blob + skeleton per frame)
- **Register Debugger** — read/write any `CamRegister` by name or raw address; "dump all" button; rolling log

> All Kinect/WebUSB logic lives in client components only. No USB code runs server-side.

## Known macOS Limitations

- **WebUSB support varies.** The Kinect USB device must be visible to the browser. On some macOS versions, system-level USB drivers may claim the device before Chrome can.
- If WebUSB cannot reliably claim the Kinect, the fallback plan is a local native bridge using [libfreenect](https://github.com/OpenKinect/libfreenect) streaming frames over WebSocket to the same frontend.
- The `@webnect/driver` package uses Web Workers and isochronous USB transfers internally. Some transfer modes may behave differently on macOS vs Linux.

## Fallback: Native Bridge (if WebUSB fails)

If WebUSB is unreliable on macOS:

1. Install libfreenect: `brew install libfreenect`
2. A small native bridge process would read depth frames via libfreenect
3. Frames would be streamed to the browser over WebSocket
4. The same frontend UI and canvas rendering would be reused

This fallback is not implemented yet — the current version is WebUSB-only.

## Tech Stack

- Next.js (App Router)
- TypeScript
- [@webnect/driver](https://www.npmjs.com/package/@webnect/driver) — WebUSB driver for Xbox 360 Kinect
- [@mediapipe/tasks-vision](https://www.npmjs.com/package/@mediapipe/tasks-vision) — Pose landmark detection (optional skeleton tracker)
- [@types/w3c-web-usb](https://www.npmjs.com/package/@types/w3c-web-usb) — WebUSB type definitions

## Skeleton Tracking Note

The original Xbox 360 Kinect hardware does **not** produce skeleton data on its own — Microsoft's NUI runtime did that in the proprietary SDK. The Studio supplies two tracker implementations:

- **Heuristic** — pure JS depth-only blob analysis, geometrically derives ~15 joints. No deps, runs everywhere.
- **MediaPipe Pose** — Google's BlazePose model running in WASM, mapped down to the same joint set. Downloads the model from Google's CDN on first init.
