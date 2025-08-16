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
  advancedColorize?: boolean;
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
let lastAdvancedColorize = true;

// Image data constants
const RGBA_STRIDE = 4;
const CHANNEL_R = 0;
const CHANNEL_G = 1;
const CHANNEL_B = 2;
const CHANNEL_A = 3;
const TRANSPARENT_ALPHA = 0;
const ORIGIN = 0;

// Perceptual mapping parameters (CIELAB + ΔE00)
// Thresholds are in CIELAB units (L* 0..100, a*/b* roughly -120..120)
const TAU_L_LAB = 3.0;
const TAU_C_LAB = 3.0;
const LAMBDA_L = 0.7;
const LAMBDA_C = 0.7;
const LAMBDA_H = 0.3;
const HUE_SIGMA_SCALE_LAB = 5.0; // σ threshold for hue stability from local a*/b* variance
const C_NEUTRAL_GATE = 3.0; // below this, hue penalty disabled
const C_NEUTRAL_BIAS = 6.0; // below this, apply extra bias against saturated palette colors
const KAPPA_NEUTRAL = 0.15; // scale for neutral bias term
const K_SHORTLIST = 8;

type PaletteLab = {
  L: number;
  a: number;
  b: number;
  C: number;
  hue: number;
  r: number;
  g: number;
  b8: number;
  a8: number;
};

function srgbToLinearComponent(c: number): number {
  const cs = c / 255;
  if (cs <= 0.04045) {
    return cs / 12.92;
  }
  return ((cs + 0.055) / 1.055) ** 2.4;
}

// sRGB -> XYZ (D65), using linearized sRGB
function rgbToXyz(r: number, g: number, b: number): { x: number; y: number; z: number } {
  const rl = srgbToLinearComponent(r);
  const gl = srgbToLinearComponent(g);
  const bl = srgbToLinearComponent(b);
  // sRGB to XYZ (D65)
  const x = 0.4124564 * rl + 0.3575761 * gl + 0.1804375 * bl;
  const y = 0.2126729 * rl + 0.7151522 * gl + 0.072175 * bl;
  const z = 0.0193339 * rl + 0.119192 * gl + 0.9503041 * bl;
  return { x, y, z };
}

function xyzToLab(x: number, y: number, z: number): { L: number; a: number; b: number } {
  // D65 reference white
  const Xn = 0.95047;
  const Yn = 1.0;
  const Zn = 1.08883;
  const d = 6 / 29;
  const d3 = d * d * d;
  const f = (t: number) => (t > d3 ? Math.cbrt(t) : t / (3 * d * d) + 4 / 29);
  const fx = f(x / Xn);
  const fy = f(y / Yn);
  const fz = f(z / Zn);
  const L = 116 * fy - 16;
  const a = 500 * (fx - fy);
  const b = 200 * (fy - fz);
  return { L, a, b };
}

function rgbToLab(r: number, g: number, b: number): { L: number; a: number; b: number } {
  const { x, y, z } = rgbToXyz(r, g, b);
  return xyzToLab(x, y, z);
}


function hueAngle(a: number, b: number): number {
  return Math.atan2(b, a);
}

function deltaHue(a1: number, b1: number, a2: number, b2: number): number {
  const h1 = hueAngle(a1, b1);
  const h2 = hueAngle(a2, b2);
  let dh = h1 - h2;
  if (dh > Math.PI) dh -= 2 * Math.PI;
  if (dh < -Math.PI) dh += 2 * Math.PI;
  return Math.abs(dh);
}

// CIEDE2000 ΔE implementation (kL=kC=kH=1)
function deltaE00(
  L1: number,
  a1: number,
  b1: number,
  L2: number,
  a2: number,
  b2: number
): number {
  const avgLp = (L1 + L2) / 2;

  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const avgC = (C1 + C2) / 2;

  const G = 0.5 * (1 - Math.sqrt((avgC ** 7) / (avgC ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const avgCp = (C1p + C2p) / 2;

  const h1p = Math.atan2(b1, a1p) < 0 ? Math.atan2(b1, a1p) + 2 * Math.PI : Math.atan2(b1, a1p);
  const h2p = Math.atan2(b2, a2p) < 0 ? Math.atan2(b2, a2p) + 2 * Math.PI : Math.atan2(b2, a2p);

  let dhp = h2p - h1p;
  if (Math.abs(dhp) > Math.PI) dhp -= Math.sign(dhp) * 2 * Math.PI;
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(dhp / 2);

  const dLp = L2 - L1;
  const dCp = C2p - C1p;

  let avgHp = h1p + h2p;
  if (Math.abs(h1p - h2p) > Math.PI) avgHp += 2 * Math.PI;
  avgHp /= 2;

  const T =
    1 -
    0.17 * Math.cos(avgHp - Math.PI / 6) +
    0.24 * Math.cos(2 * avgHp) +
    0.32 * Math.cos(3 * avgHp + Math.PI / 30) -
    0.2 * Math.cos(4 * avgHp - (63 * Math.PI) / 180);

  const Sl = 1 + (0.015 * (avgLp - 50) ** 2) / Math.sqrt(20 + (avgLp - 50) ** 2);
  const Sc = 1 + 0.045 * avgCp;
  const Sh = 1 + 0.015 * avgCp * T;

  const dTheta = (30 * Math.PI) / 180 * Math.exp(-(((180 / Math.PI * avgHp - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt((avgCp ** 7) / (avgCp ** 7 + 25 ** 7));
  const Rt = -Rc * Math.sin(2 * dTheta);

  const kl = 1;
  const kc = 1;
  const kh = 1;

  const termL = dLp / (kl * Sl);
  const termC = dCp / (kc * Sc);
  const termH = dHp / (kh * Sh);
  const dE = Math.sqrt(termL * termL + termC * termC + termH * termH + Rt * termC * termH);
  return dE;
}

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
  lastAdvancedColorize = msg.advancedColorize ?? true;
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
    if (lastAdvancedColorize) {
      mapImageDataToPalette(imgData, lastPalette);
    } else {
      mapImageDataToPaletteClassic(imgData, lastPalette);
    }
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
    if (lastAdvancedColorize) {
      mapImageDataToPalette(imgData, lastPalette);
    } else {
      mapImageDataToPaletteClassic(imgData, lastPalette);
    }
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

  const width = img.width;
  const height = img.height;
  const numPixels = width * height;

  // Precompute CIELAB for the image (one pass)
  const Larr = new Float32Array(numPixels);
  const Aarr = new Float32Array(numPixels);
  const Barr = new Float32Array(numPixels);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const i = idx * RGBA_STRIDE;
      const a8 = d[i + CHANNEL_A];
      if (a8 === TRANSPARENT_ALPHA) {
        Larr[idx] = 0;
        Aarr[idx] = 0;
        Barr[idx] = 0;
        continue;
      }
      const r = d[i + CHANNEL_R];
      const g = d[i + CHANNEL_G];
      const b = d[i + CHANNEL_B];
      const lab = rgbToLab(r, g, b);
      Larr[idx] = lab.L;
      Aarr[idx] = lab.a;
      Barr[idx] = lab.b;
    }
  }

  // Precompute palette in Lab
  const pal: PaletteLab[] = [];
  pal.length = paletteLen / RGBA_STRIDE;
  for (let p = 0, pi = 0; p < paletteLen; p += RGBA_STRIDE, pi++) {
    const pr = palette[p + CHANNEL_R];
    const pg = palette[p + CHANNEL_G];
    const pb = palette[p + CHANNEL_B];
    const pa = palette[p + CHANNEL_A];
    const lab = rgbToLab(pr, pg, pb);
    const C = Math.hypot(lab.a, lab.b);
    pal[pi] = {
      L: lab.L,
      a: lab.a,
      b: lab.b,
      C,
      hue: hueAngle(lab.a, lab.b),
      r: pr,
      g: pg,
      b8: pb,
      a8: pa,
    };
  }

  // Helper: local hue stability weight based on 3x3 window sigma of a/b
  function hueWeightAt(x: number, y: number): number {
    let sumA = 0;
    let sumB = 0;
    let sumAA = 0;
    let sumBB = 0;
    let count = 0;
    for (let dy = -1; dy <= 1; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= height) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx;
        if (xx < 0 || xx >= width) continue;
        const idn = yy * width + xx;
        const a = Aarr[idn];
        const b = Barr[idn];
        sumA += a;
        sumB += b;
        sumAA += a * a;
        sumBB += b * b;
        count++;
      }
    }
    if (count === 0) return 0;
    const meanA = sumA / count;
    const meanB = sumB / count;
    const varA = Math.max(0, sumAA / count - meanA * meanA);
    const varB = Math.max(0, sumBB / count - meanB * meanB);
    const sigma = Math.sqrt(varA + varB);
    const w = 1 - Math.min(1, sigma / HUE_SIGMA_SCALE_LAB);
    return w;
  }

  // Main mapping
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const i = idx * RGBA_STRIDE;
      const a8 = d[i + CHANNEL_A];
      if (a8 === TRANSPARENT_ALPHA) {
        continue;
      }

      const Lr = Larr[idx];
      const ar = Aarr[idx];
      const br = Barr[idx];
      const Cr = Math.hypot(ar, br);
      const hWeight = hueWeightAt(x, y);

      // First pass: shortlist K by raw ΔE00
      const topIdx = new Int16Array(K_SHORTLIST);
      const topScore = new Float32Array(K_SHORTLIST);
      for (let k = 0; k < K_SHORTLIST; k++) {
        topIdx[k] = -1;
        topScore[k] = Number.POSITIVE_INFINITY;
      }
      for (let pi = 0; pi < pal.length; pi++) {
        const pcol = pal[pi];
        const base = deltaE00(Lr, ar, br, pcol.L, pcol.a, pcol.b);
        // insert into topK if better than worst
        let worstK = 0;
        let worstVal = -1;
        for (let k = 0; k < K_SHORTLIST; k++) {
          if (topScore[k] > worstVal) {
            worstVal = topScore[k];
            worstK = k;
          }
        }
        if (base < worstVal) {
          topScore[worstK] = base;
          topIdx[worstK] = pi as unknown as number;
        }
      }

      // Second pass: apply penalties/context to shortlisted
      let bestPi = topIdx[0] >= 0 ? topIdx[0] : 0;
      let bestCost = Number.POSITIVE_INFINITY;
      for (let k = 0; k < K_SHORTLIST; k++) {
        const pi = topIdx[k];
        if (pi < 0) continue;
        const pcol = pal[pi];
        const base = topScore[k];

        const dL = Math.abs(Lr - pcol.L);
        const Lpen = LAMBDA_L * Math.max(0, dL - TAU_L_LAB);

        const dC = Math.abs(Cr - pcol.C);
        const Cpen = LAMBDA_C * Math.max(0, dC - TAU_C_LAB);

        let Hpen = 0;
        if (Cr >= C_NEUTRAL_GATE) {
          const dh = deltaHue(ar, br, pcol.a, pcol.b);
          Hpen = LAMBDA_H * hWeight * (1 - Math.cos(dh));
        }

        let neutralBias = 0;
        if (Cr < C_NEUTRAL_BIAS) {
          neutralBias = KAPPA_NEUTRAL * pcol.C;
        }

        const cost = base + Lpen + Cpen + Hpen + neutralBias;
        if (cost < bestCost) {
          bestCost = cost;
          bestPi = pi as unknown as number;
        }
      }

      const best = pal[bestPi];
      d[i + CHANNEL_R] = best.r;
      d[i + CHANNEL_G] = best.g;
      d[i + CHANNEL_B] = best.b8;
      d[i + CHANNEL_A] = best.a8;
    }
  }
}

function mapImageDataToPaletteClassic(img: ImageData, palette: Uint8ClampedArray) {
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
