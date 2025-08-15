/*
  Pixelation worker: downscales to tiles grid, then upscales without smoothing.
  This approximates block-average colors efficiently and returns an ImageBitmap
  for smooth transfer back to the main thread. It also supports PNG blob generation
  on demand without blocking the UI thread.
*/

export type PixelateProcessMessage = {
  type: 'process';
  jobId: number;
  blockSize: number;
  bitmap?: ImageBitmap;
  colorizeEnabled?: boolean;
  /** Flat RGBA array [r,g,b,a,...] of allowed palette colors */
  palette?: number[];
};

export type PixelateCancelMessage = {
  type: 'cancel';
  jobId: number;
};

export type PixelateGenerateBlobMessage = {
  type: 'generateBlob';
  jobId: number;
};

export type PixelateIncomingMessage =
  | PixelateProcessMessage
  | PixelateCancelMessage
  | PixelateGenerateBlobMessage;

export type PixelateResultMessage = {
  type: 'result';
  jobId: number;
  bitmap: ImageBitmap;
  meta: {
    outWidth: number;
    outHeight: number;
    tilesX: number;
    tilesY: number;
    totalPixels: number;
    blockSize: number;
  };
};

export type PixelateBlobMessage = {
  type: 'blob';
  jobId: number;
  blob: Blob;
};

let activeJobId: number | null = null;
let lastRenderedJobId: number | null = null;
const ctx = self as unknown as DedicatedWorkerGlobalScope;
let lastSourceBitmap: ImageBitmap | null = null;
let lastBlockSize: number | null = null;
let lastPalette: Uint8ClampedArray | null = null;
let lastColorizeEnabled = true;

// Image data constants
const RGBA_STRIDE = 4;
const CHANNEL_R = 0;
const CHANNEL_G = 1;
const CHANNEL_B = 2;
const CHANNEL_A = 3;
const TRANSPARENT_ALPHA = 0;
const ORIGIN = 0;

function computeTilesDimension(
  width: number,
  height: number,
  blockSize: number
) {
  const tilesX = Math.max(1, Math.ceil(width / blockSize));
  const tilesY = Math.max(1, Math.ceil(height / blockSize));
  return { tilesX, tilesY };
}

function handleProcessMessage(msg: PixelateProcessMessage) {
  activeJobId = msg.jobId;

  const { blockSize } = msg;
  if (msg.bitmap) {
    lastSourceBitmap = msg.bitmap;
  }
  lastBlockSize = blockSize;
  lastColorizeEnabled = msg.colorizeEnabled ?? true;
  if (Array.isArray(msg.palette) && msg.palette.length >= RGBA_STRIDE) {
    lastPalette = new Uint8ClampedArray(msg.palette);
  } else {
    lastPalette = null;
  }
  const source = lastSourceBitmap;
  if (!source) {
    return;
  }
  const width = source.width;
  const height = source.height;
  const { tilesX, tilesY } = computeTilesDimension(width, height, blockSize);

  // Downscale to tile grid (final output resolution equals tiles)
  const out = new OffscreenCanvas(tilesX, tilesY);
  const octx = out.getContext('2d');
  if (!octx) {
    return;
  }
  octx.imageSmoothingEnabled = true;
  octx.clearRect(ORIGIN, ORIGIN, tilesX, tilesY);
  octx.drawImage(source, ORIGIN, ORIGIN, tilesX, tilesY);

  // Optional palette colorization
  if (lastColorizeEnabled && lastPalette && lastPalette.length >= RGBA_STRIDE) {
    const imgData = octx.getImageData(ORIGIN, ORIGIN, tilesX, tilesY);
    mapImageDataToPalette(imgData, lastPalette);
    octx.putImageData(imgData, ORIGIN, ORIGIN);
  }

  // If a newer job started while we worked, ignore this result.
  if (activeJobId !== msg.jobId) {
    return;
  }

  const resultBitmap = out.transferToImageBitmap();
  lastRenderedJobId = msg.jobId;

  const meta = {
    outWidth: tilesX,
    outHeight: tilesY,
    tilesX,
    tilesY,
    totalPixels: tilesX * tilesY,
    blockSize,
  };

  const result: PixelateResultMessage = {
    type: 'result',
    jobId: msg.jobId,
    bitmap: resultBitmap,
    meta,
  };

  // Transfer result bitmap to main thread.
  ctx.postMessage(result, [resultBitmap]);
}

async function handleGenerateBlobMessage(msg: PixelateGenerateBlobMessage) {
  if (
    lastRenderedJobId !== msg.jobId ||
    !lastSourceBitmap ||
    lastBlockSize === null
  ) {
    return;
  }
  // Re-render at tile resolution for download
  const src = lastSourceBitmap;
  const width = src.width;
  const height = src.height;
  const { tilesX, tilesY } = computeTilesDimension(
    width,
    height,
    lastBlockSize
  );
  const outCanvas = new OffscreenCanvas(tilesX, tilesY);
  const octx = outCanvas.getContext('2d');
  if (!octx) {
    return;
  }
  octx.imageSmoothingEnabled = true;
  octx.clearRect(ORIGIN, ORIGIN, tilesX, tilesY);
  octx.drawImage(src, ORIGIN, ORIGIN, tilesX, tilesY);
  if (lastColorizeEnabled && lastPalette && lastPalette.length >= RGBA_STRIDE) {
    const imgData = octx.getImageData(ORIGIN, ORIGIN, tilesX, tilesY);
    mapImageDataToPalette(imgData, lastPalette);
    octx.putImageData(imgData, ORIGIN, ORIGIN);
  }

  const blob = await outCanvas.convertToBlob({ type: 'image/png' });
  const out: PixelateBlobMessage = { type: 'blob', jobId: msg.jobId, blob };
  ctx.postMessage(out);
}

ctx.onmessage = (event: MessageEvent<PixelateIncomingMessage>) => {
  const data = event.data;
  if (data.type === 'cancel') {
    if (activeJobId === data.jobId) {
      activeJobId = null;
    }
    return;
  }
  if (data.type === 'process') {
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    handleProcessMessage(data);
    return;
  }
  if (data.type === 'generateBlob') {
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    handleGenerateBlobMessage(data);
  }
};

function mapImageDataToPalette(img: ImageData, palette: Uint8ClampedArray) {
  const d = img.data;
  const paletteLen = palette.length;
  if (paletteLen < RGBA_STRIDE) {
    return;
  }
  for (let i = 0; i < d.length; i += RGBA_STRIDE) {
    const r = d[i + CHANNEL_R];
    const g = d[i + CHANNEL_G];
    const b = d[i + CHANNEL_B];
    const a = d[i + CHANNEL_A];
    if (a === TRANSPARENT_ALPHA) {
      continue;
    }
    let bestIndex = 0;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let p = 0; p < paletteLen; p += RGBA_STRIDE) {
      const pr = palette[p + CHANNEL_R];
      const pg = palette[p + CHANNEL_G];
      const pb = palette[p + CHANNEL_B];
      // Ignore alpha in distance metric; choose exact 0 alpha only if included explicitly
      const dr = pr - r;
      const dg = pg - g;
      const db = pb - b;
      const dist = dr * dr + dg * dg + db * db;
      if (dist < bestDist) {
        bestDist = dist;
        bestIndex = p;
      }
    }
    d[i + CHANNEL_R] = palette[bestIndex + CHANNEL_R];
    d[i + CHANNEL_G] = palette[bestIndex + CHANNEL_G];
    d[i + CHANNEL_B] = palette[bestIndex + CHANNEL_B];
    d[i + CHANNEL_A] = palette[bestIndex + CHANNEL_A];
  }
}
