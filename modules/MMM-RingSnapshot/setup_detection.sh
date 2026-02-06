#!/bin/bash
# One-time setup for person detection in MMM-RingSnapshot
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VENV_DIR="$SCRIPT_DIR/venv"
MODEL_DIR="$SCRIPT_DIR/model"
MODEL_URL="https://storage.googleapis.com/download.tensorflow.org/models/tflite/coco_ssd_mobilenet_v1_1.0_quant_2018_06_29.zip"

echo "=== MMM-RingSnapshot Person Detection Setup ==="

# Create Python venv
echo "Creating Python virtual environment..."
python3 -m venv "$VENV_DIR"

# Install dependencies
echo "Installing Python dependencies..."
"$VENV_DIR/bin/pip" install --upgrade pip
"$VENV_DIR/bin/pip" install ai-edge-litert pillow numpy

# Download model
echo "Downloading SSD MobileNet v1 COCO TFLite model..."
mkdir -p "$MODEL_DIR"
TMP_ZIP=$(mktemp /tmp/ssd_mobilenet_XXXXXX.zip)
curl -L -o "$TMP_ZIP" "$MODEL_URL"
unzip -o "$TMP_ZIP" -d "$MODEL_DIR"
mv "$MODEL_DIR/detect.tflite" "$MODEL_DIR/detect.tflite" 2>/dev/null || true
mv "$MODEL_DIR/labelmap.txt" "$MODEL_DIR/labelmap.txt" 2>/dev/null || true
rm -f "$TMP_ZIP"

echo ""
echo "=== Setup complete ==="
echo "Model: $MODEL_DIR/detect.tflite"
echo "Venv:  $VENV_DIR"
echo ""
echo "Test with:"
echo "  $VENV_DIR/bin/python3 $SCRIPT_DIR/detect_person.py <image.jpg> 0.5"
