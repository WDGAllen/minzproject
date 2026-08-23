#!/bin/bash

if [ -z "$1" ]; then
    echo "Usage: ./run_zproject_final.sh your_video.mov"
    exit 1
fi

INPUT_VIDEO="$1"

# --- CONFIGURATION AREA ---
# Adjust these targets based on your manual feature tracking.
TARGET_DX=0
TARGET_DY=0
# --------------------------

# Create output directory named after the video file
OUT_DIR="${INPUT_VIDEO%.*}"
mkdir -p "$OUT_DIR"

echo "=== Analyzing video metadata ==="
TOTAL_FRAMES=$(ffprobe -v error -select_streams v:0 -count_packets -show_entries stream=nb_read_packets -of default=noprint_wrappers=1:nokey=1 "$INPUT_VIDEO")

if [ -z "$TOTAL_FRAMES" ] || [ "$TOTAL_FRAMES" = "N/A" ]; then
    DURATION=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$INPUT_VIDEO")
    FPS=$(ffprobe -v error -select_streams v:0 -show_entries stream=r_frame_rate -of default=noprint_wrappers=1:nokey=1 "$INPUT_VIDEO" | awk -F/ '{print $1/$2}')
    TOTAL_FRAMES=$(python -c "print(int(round($DURATION * $FPS)))")
fi

echo "Total frames: $TOTAL_FRAMES"
echo "Output directory: ./$OUT_DIR"
echo "=== Processing video and calculating sequential 200-frame blocks ==="

ffmpeg -threads 16 -i "$INPUT_VIDEO" -f rawvideo -pix_fmt rgb24 - | python -c "
import sys, os, numpy as np
import matplotlib.image as mpimg

w, h = 1920, 1080
f_size = w * h * 3
total_frames = $TOTAL_FRAMES
max_frame = total_frames - 1
out_dir = '$OUT_DIR'

target_dx = $TARGET_DX
target_dy = $TARGET_DY

# Calculate the precise maximum shift bounding box to crop out stabilization artifacts
# Track the absolute min and max pixel displacements that occur during translation
shifts_x = [int(round(target_dx * (f / max_frame))) for f in range(total_frames)] if max_frame > 0 else [0]
shifts_y = [int(round(target_dy * (f / max_frame))) for f in range(total_frames)] if max_frame > 0 else [0]

min_dx, max_dx = min(shifts_x), max(shifts_x)
min_dy, max_dy = min(shifts_y), max(shifts_y)

# Determine crop boundaries (slicing out any edges exposed during rolling)
crop_top = max(0, max_dy)
crop_bottom = h + min(0, min_dy)
crop_left = max(0, max_dx)
crop_right = w + min(0, min_dx)

# Initialize master image accumulator
master_min = None
# Initialize interval structures
interval_size = 200
current_interval_min = None

frame_idx = 0

while True:
    data = sys.stdin.buffer.read(f_size)
    if len(data) < f_size: break
    frame = np.frombuffer(data, dtype=np.uint8).reshape((h, w, 3))
    
    # Apply manual stabilization
    if target_dx != 0 or target_dy != 0:
        factor = frame_idx / max_frame if max_frame > 0 else 0
        dx = int(round(target_dx * factor))
        dy = int(round(target_dy * factor))
        if dx != 0 or dy != 0:
            frame = np.roll(frame, shift=(dy, dx), axis=(0, 1))
            
    # Accumulate into master projection
    if master_min is None:
        master_min = np.copy(frame)
    else:
        np.minimum(master_min, frame, out=master_min)
        
    # Accumulate into sequential 200-frame interval projection
    if current_interval_min is None:
        current_interval_min = np.copy(frame)
    else:
        np.minimum(current_interval_min, frame, out=current_interval_min)
        
    frame_idx += 1
    
    # Save interval slice when threshold is met
    if frame_idx % interval_size == 0:
        # Convert, crop, and save
        gray_interval = (0.299 * current_interval_min[:,:,0] + 0.587 * current_interval_min[:,:,1] + 0.114 * current_interval_min[:,:,2]).astype(np.uint8)
        cropped_interval = gray_interval[crop_top:crop_bottom, crop_left:crop_right]
        
        start_f = frame_idx - interval_size
        end_f = frame_idx - 1
        mpimg.imsave(os.path.join(out_dir, f'z_slice_frames_{start_f:04d}_to_{end_f:04d}.png'), cropped_interval, cmap='gray')
        current_interval_min = None # Reset for next slice

    if frame_idx % 500 == 0:
        sys.stderr.write(f'Processed {frame_idx}/{total_frames} frames...\n')

# Handle the remainder slice if total frames isn't perfectly divisible by 200
if current_interval_min is not None:
    gray_interval = (0.299 * current_interval_min[:,:,0] + 0.587 * current_interval_min[:,:,1] + 0.114 * current_interval_min[:,:,2]).astype(np.uint8)
    cropped_interval = gray_interval[crop_top:crop_bottom, crop_left:crop_right]
    start_f = (frame_idx // interval_size) * interval_size
    end_f = frame_idx - 1
    mpimg.imsave(os.path.join(out_dir, f'z_slice_frames_{start_f:04d}_to_{end_f:04d}_remainder.png'), cropped_interval, cmap='gray')

# Save the full master 100% projection file
if master_min is not None:
    gray_master = (0.299 * master_min[:,:,0] + 0.587 * master_min[:,:,1] + 0.114 * master_min[:,:,2]).astype(np.uint8)
    cropped_master = gray_master[crop_top:crop_bottom, crop_left:crop_right]
    mpimg.imsave(os.path.join(out_dir, 'z_master_100_percent.png'), cropped_master, cmap='gray')
"

echo "=== Success! All processed image data cleanly isolated to: ./${OUT_DIR}/ ==="
