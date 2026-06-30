# MikesMagicMirror

A [MagicMirror](https://magicmirror.builders/) (v2.34.0) setup running on a Raspberry Pi with Ring camera integration, AI-powered object detection, and a two-page touchscreen dashboard.

## Features

- **Ring Camera Snapshots** — Live snapshots from Ring doorbells and cameras, refreshed periodically and on motion events
- **AI Object Detection** — TFLite-based detection filters motion alerts to only show when a person, vehicle, or animal is in frame (SSD MobileNet v1 COCO)
- **Two-Page Dashboard** — Swipe between a main dashboard (clock, cameras, weather, indoor climate, calendar) and an info page (forecast, news, system stats)
- **Touch Control** — Tap to switch pages
- **Remote Control** — Web-based remote management with monitor on/off

## Modules

| Module                 | Description                                                   |
| ---------------------- | ------------------------------------------------------------- |
| **MMM-RingSnapshot**   | Ring camera snapshots with AI person/vehicle/animal detection |
| **MMM-DHT-Sensor**     | Indoor temperature and humidity from a DHT sensor             |
| **MMM-pages**          | Page/slide navigation for grouping modules                    |
| **MMM-page-indicator** | Visual indicator showing current page                         |
| **MMM-Touch**          | Touch gesture support (tap to change pages)                   |
| **MMM-Remote-Control** | Web-based remote control interface                            |
| **MMM-SystemStats**    | CPU temp, RAM, disk, and uptime display                       |
| **MMM-PowerButtons**   | On-screen power/reboot/monitor controls                       |

## Setup

### 1. Install MagicMirror

Follow the [official installation guide](https://docs.magicmirror.builders/getting-started/installation.html), or clone this repo:

```bash
git clone git@github.com:mbrande/MikesMagicMirror.git ~/MagicMirror
cd ~/MagicMirror
npm install
```

### 2. Configure

Copy the example config and fill in your values:

```bash
cp config/config.js.example config/config.js
```

You'll need to set:

- `apiKey` for MMM-Remote-Control
- Google Calendar private iCal URL
- Weather coordinates (lat/lon)

### 3. Ring Camera Setup

```bash
cd modules/MMM-RingSnapshot
npm install
```

Create a Ring refresh token ([instructions](https://github.com/dgreif/ring/wiki/Refresh-Tokens)) and save it:

```bash
cp ring-token.json.example ring-token.json
# Edit ring-token.json with your refresh token
```

### 4. AI Detection Setup

Run the one-time setup script to install the TFLite model and Python dependencies:

```bash
cd modules/MMM-RingSnapshot
bash setup_detection.sh
```

This creates a Python venv, installs `ai-edge-litert`, `pillow`, and `numpy`, and downloads the quantized SSD MobileNet v1 COCO model (~4MB).

Test it manually:

```bash
venv/bin/python3 detect_person.py <image.jpg> 0.5
```

### 5. Run

```bash
# With PM2 (recommended):
pm2 start npm --name magicmirror -- run start
pm2 save

# Or directly:
npm run start
```

## AI Detection Config

These options go in the `MMM-RingSnapshot` config block in `config/config.js`:

| Option              | Default | Description                                                       |
| ------------------- | ------- | ----------------------------------------------------------------- |
| `personDetection`   | `true`  | Alert on person detection                                         |
| `personConfidence`  | `0.5`   | Person confidence threshold (0-1)                                 |
| `vehicleDetection`  | `true`  | Alert on vehicle detection (car, truck, bus, motorcycle, bicycle) |
| `vehicleConfidence` | `0.5`   | Vehicle confidence threshold (0-1)                                |
| `animalDetection`   | `true`  | Alert on animal detection (cat, dog, bird, etc.)                  |
| `animalConfidence`  | `0.5`   | Animal confidence threshold (0-1)                                 |

Detection is fail-open: if the model errors or times out, motion alerts pass through normally. Detection only runs once at the start of a motion event, not during the 5-second refresh cycle.

## Hardware

- Raspberry Pi 5
- Ring Doorbell / Camera
- DHT temperature/humidity sensor
- HDMI touchscreen display

## License

MagicMirror is licensed under [MIT](LICENSE.md). Based on [MagicMirror](https://github.com/MagicMirrorOrg/MagicMirror) by MagicMirrorOrg.
