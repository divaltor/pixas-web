## Pixel Art Converter – Implementation Plan

### Architecture
- **App**: React 19 + Vite + TanStack Router route (`/`).
- **UI kit**: shadcn/ui components via CLI.
- **Workers**: Pixelation runs in a Web Worker (uses `OffscreenCanvas` when available; fallback to `ImageData`).
- **Rendering**: Canvas output with nearest-neighbor scaling; viewer uses CSS transform for zoom/pan with `image-rendering: pixelated`.

### UI layout
- Two-column responsive grid.
  - Left: Controls (file input, block size slider, zoom controls, output info, download).
  - Right: Viewer (pixelated canvas) with zoom and pan.
- Mobile: Stack vertically; controls above viewer.
- Components: `Card`, `Button`, `Input`, `Label`, `Slider`, `Separator`, `Tooltip`, `Skeleton`, `Toaster`.

### Pixelation algorithm (Worker)
- Input: `ImageBitmap` + `blockSize` (1..32).
- Process: For each tile, compute average color and draw 1 tile → 1 block pixel.
- Fast path: `OffscreenCanvas` rendering + `transferToImageBitmap()`.
- Fallback: Produce `ImageData` and return transferable buffer.
- Output: `ImageBitmap` (preview), metadata `{ outWidth, outHeight, tilesX, tilesY, totalPixels }`.
- Download: On demand, render PNG `Blob` and transfer.

### State model
- `sourceFile`, `sourceBitmap`.
- `blockSize` (1..32), debounced.
- `zoom` (0.25..8), `pan {x,y}`.
- `status` (`idle` | `processing` | `ready` | `error`).
- `resultBitmap`, `resultBlob?` (for download), `meta`.

### Controls
- File input: accept common image MIME types, decode to `ImageBitmap`.
- Block size: slider 1..32 step 1; debounce ~200ms.
- Zoom: slider + +/- buttons + Fit/100% shortcuts; mouse wheel (with modifier) and drag-to-pan.
- Output info: width, height, total pixels (tilesX * tilesY).
- Download: triggers PNG generation (cached once computed).

### Viewer
- Canvas inside pan/zoom container with pointer events.
- CSS: `image-rendering: pixelated`; transform scale/translate with `will-change: transform`.
- Double-click to zoom, Shift+double-click to zoom out.

### Performance & UX
- Conversion off main thread; show `Skeleton` while processing.
- Debounce parameter changes; cancel stale worker jobs.
- Use transferable objects (`ImageBitmap`, `ArrayBuffer`).
- Throttle wheel/drag with `requestAnimationFrame`.

### Accessibility
- Proper labels and `type="button"` on buttons.
- Keyboard zoom (+/-) and focus states.
- Canvas has descriptive `aria-label` and adjacent textual description.

### Error handling
- Invalid type/too-large images → toast; downscale to a safe max; allow retry.
- Worker errors → toast and recover.

### Steps
- [x] Add shadcn/ui components via CLI: `slider`, `separator`, `tooltip`, `scroll-area`.
- [x] Create `src/workers/pixelate.worker.ts` (tile-based pixelation; bitmap/meta output).
- [x] Create `src/components/pixel-controls.tsx` (inputs, sliders, info, download).
- [x] Create `src/components/pixel-viewer.tsx` (canvas + zoom/pan interactions).
- [x] Integrate into `src/routes/index.tsx` to render the layout.
- [x] Add helpers `src/lib/image.ts` (decode image; constrain dimensions).
- [x] Wire toasts and loading skeletons.
- [x] Format/lint and fix any issues.

### Upcoming features
- [ ] Light mode support with system preference and a subtle header switcher
- [ ] Ensure block size changes immediately re-render (no transfer neutering)
- [ ] Fix zoom control so the preview scales live
- [ ] Add grid overlay on the canvas (toggleable)
- [ ] Constrain panning so the image cannot be dragged outside the viewport
- [ ] Improve output width/height UX (highlight numbers for readability)

### Acceptance criteria
- UI remains responsive while converting.
- Block size up to 32; live re-render on change.
- Smooth zoom/pan with Fit and 100%.
- Output metadata accurate.
- Download produces a correct PNG.

