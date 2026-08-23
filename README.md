# Bird Movement Projection

Static browser-only prototype for the full minimum-intensity projection in `zproject_200.sh`.

## Run locally

Serve this folder over HTTP (video decoding and local-file APIs are more reliable from a local origin):

```sh
python3 -m http.server 8000
```

Then open `http://localhost:8000`. The selected video is processed locally in the browser and is never uploaded.

## Current scope

The app uses the browser's native video decoder, reads frames through a canvas, accumulates per-channel RGB minima, then applies the reference luminance coefficients `0.299 / 0.587 / 0.114`. It intentionally omits stabilization and interval projections. Frame timing is estimated from the video duration with a 30 fps fallback; this is the first prototype's main validation point against FFmpeg output.
