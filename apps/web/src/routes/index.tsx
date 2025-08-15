import { createFileRoute } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PixelControls } from '@/components/pixel-controls';
import { PixelViewer } from '@/components/pixel-viewer';
import { decodeFileToBitmap } from '@/lib/image';
import type {
  PixelateBlobMessage,
  PixelateIncomingMessage,
  PixelateResultMessage,
} from '@/workers/pixelate.worker';

export const Route = createFileRoute('/')({
  component: HomeComponent,
});

const RGBA_STRIDE = 4;
const FULLY_OPAQUE_ALPHA = 255;
const HEX_RADIX = 16;
const HEX_TRIPLET_LEN = 3;
const HEX_SIX_LEN = 6;
const HEX_BYTE_SLICE_START = 0;
const HEX_BYTE_SLICE_MIDDLE = 2;
const HEX_BYTE_SLICE_END = 4;
const TRANSPARENT_RGBA: [number, number, number, number] = [0, 0, 0, 0];

function hexToRgbaComponents(
  hex: string
): [number, number, number, number] | null {
  const lower = hex.toLowerCase();
  if (lower === 'transparent') {
    return TRANSPARENT_RGBA;
  }
  let h = hex.trim();
  if (h.startsWith('#')) {
    h = h.slice(1);
  }
  if (h.length === HEX_TRIPLET_LEN) {
    const r = Number.parseInt(h[0] + h[0], HEX_RADIX);
    const g = Number.parseInt(h[1] + h[1], HEX_RADIX);
    const b = Number.parseInt(h[2] + h[2], HEX_RADIX);
    return [r, g, b, FULLY_OPAQUE_ALPHA];
  }
  if (h.length === HEX_SIX_LEN) {
    const r = Number.parseInt(h.slice(HEX_BYTE_SLICE_START, 2), HEX_RADIX);
    const g = Number.parseInt(
      h.slice(HEX_BYTE_SLICE_MIDDLE, HEX_BYTE_SLICE_END),
      HEX_RADIX
    );
    const b = Number.parseInt(
      h.slice(HEX_BYTE_SLICE_END, HEX_SIX_LEN),
      HEX_RADIX
    );
    return [r, g, b, FULLY_OPAQUE_ALPHA];
  }
  return null;
}

function HomeComponent() {
  const workerRef = useRef<Worker | null>(null);
  const [jobId, setJobId] = useState(0);
  const DEFAULT_BLOCK_SIZE = 16;
  const [blockSize, setBlockSize] = useState(DEFAULT_BLOCK_SIZE);
  const [zoom, setZoom] = useState(1);
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [result, setResult] = useState<{
    bitmap: ImageBitmap;
    meta: {
      outWidth: number;
      outHeight: number;
      tilesX: number;
      tilesY: number;
      totalPixels: number;
      blockSize: number;
    };
  } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [colorizeEnabled, setColorizeEnabled] = useState(true);
  const [paletteEntries, setPaletteEntries] = useState<
    Array<{ key: string; hex: string; isPremium: boolean }>
  >([]);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const paletteAbortRef = useRef(false);

  useEffect(() => {
    const w = new Worker(
      new URL('../workers/pixelate.worker.ts', import.meta.url),
      { type: 'module' }
    );
    workerRef.current = w;
    const handle = (
      e: MessageEvent<
        PixelateIncomingMessage | PixelateResultMessage | PixelateBlobMessage
      >
    ) => {
      const data = e.data as PixelateResultMessage | PixelateBlobMessage;
      if (data.type === 'result') {
        setResult({ bitmap: data.bitmap, meta: data.meta });
        setIsProcessing(false);
        return;
      }
      if (data.type === 'blob') {
        const url = URL.createObjectURL(data.blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `pixel-art-${data.jobId}.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      }
    };
    w.addEventListener('message', handle as EventListener);
    return () => {
      w.removeEventListener('message', handle as EventListener);
      w.terminate();
    };
  }, []);

  // Load palette once
  useEffect(() => {
    paletteAbortRef.current = false;
    async function load() {
      try {
        const res = await fetch('/palette.json');
        const json = (await res.json()) as Record<
          string,
          { color: string; is_premium: boolean }
        >;
        if (paletteAbortRef.current) {
          return;
        }
        const entries = Object.entries(json).map(([key, v]) => ({
          key,
          hex: v.color,
          isPremium: v.is_premium,
        }));
        setPaletteEntries(entries);
        setSelectedKeys(entries.map((e) => e.key)); // default all selected
      } catch (_err) {
        /* noop */
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    load();
    return () => {
      paletteAbortRef.current = true;
    };
  }, []);

  const selectedPaletteArray = useMemo(() => {
    const selected = new Set(selectedKeys);
    const out: number[] = [];
    for (const e of paletteEntries) {
      if (!selected.has(e.key)) {
        continue;
      }
      const rgba = hexToRgbaComponents(e.hex);
      if (rgba) {
        out.push(rgba[0], rgba[1], rgba[2], rgba[3]);
      }
    }
    if (out.length % RGBA_STRIDE !== 0) {
      return out.slice(0, out.length - (out.length % RGBA_STRIDE));
    }
    return out;
  }, [paletteEntries, selectedKeys]);

  const startProcess = useCallback(
    (newBlockSize: number, source: ImageBitmap, includeBitmap: boolean) => {
      const nextJob = Number(Date.now());
      setJobId(nextJob);
      setIsProcessing(true);
      type ProcessMessage =
        | {
            type: 'process';
            jobId: number;
            blockSize: number;
            colorizeEnabled?: boolean;
            palette?: number[];
          }
        | {
            type: 'process';
            jobId: number;
            blockSize: number;
            bitmap: ImageBitmap;
            colorizeEnabled?: boolean;
            palette?: number[];
          };
      const paletteArray = selectedPaletteArray;
      const enableColorize =
        colorizeEnabled && paletteArray.length >= RGBA_STRIDE;
      const baseExtra = {
        colorizeEnabled: enableColorize,
        palette: paletteArray,
      } as const;
      const baseMsg: ProcessMessage = includeBitmap
        ? {
            type: 'process',
            jobId: nextJob,
            blockSize: newBlockSize,
            bitmap: source,
            ...baseExtra,
          }
        : {
            type: 'process',
            jobId: nextJob,
            blockSize: newBlockSize,
            ...baseExtra,
          };
      workerRef.current?.postMessage(baseMsg);
    },
    [colorizeEnabled, selectedPaletteArray]
  );

  async function handleFile(file: File) {
    const decoded = await decodeFileToBitmap(file);
    setBitmap(decoded.bitmap);
    startProcess(blockSize, decoded.bitmap, true);
  }

  function handleBlockSizeChange(v: number) {
    setBlockSize(v);
    if (!bitmap) {
      return;
    }
    startProcess(v, bitmap, false);
  }

  function zoomFit(containerW: number, containerH: number) {
    const w = result?.bitmap.width ?? bitmap?.width ?? 0;
    const h = result?.bitmap.height ?? bitmap?.height ?? 0;
    if (w === 0 || h === 0) {
      return;
    }
    const MIN_ZOOM = 0.25;
    const MAX_ZOOM = 8;
    const scaleByWidth = containerW / w;
    const scaleByHeight = containerH / h;
    const bestScale = Math.min(scaleByWidth, scaleByHeight);
    const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, bestScale));
    const precision = 3;
    const scale = Number(clamped.toFixed(precision));
    setZoom(scale);
  }

  function onDownload() {
    if (!result) {
      return;
    }
    workerRef.current?.postMessage({ type: 'generateBlob', jobId });
  }

  // moved above to satisfy ordering

  // Re-run when palette settings change
  useEffect(() => {
    if (bitmap && result) {
      startProcess(blockSize, bitmap, false);
    }
  }, [bitmap, result, blockSize, startProcess]);

  return (
    <div className="container mx-auto h-full px-4 py-4">
      <div className="grid h-full gap-4 md:grid-cols-[360px_1fr]">
        <section className="rounded-lg border p-4">
          <PixelControls
            blockSize={blockSize}
            colorizeEnabled={colorizeEnabled}
            disabled={isProcessing && !result}
            gridEnabled={showGrid}
            meta={result?.meta}
            onBlockSizeChange={handleBlockSizeChange}
            onDownload={onDownload}
            onFileSelected={handleFile}
            onSelectAll={(premium) => {
              if (premium === 'all') {
                setSelectedKeys(paletteEntries.map((e) => e.key));
                return;
              }
              setSelectedKeys(
                paletteEntries
                  .filter((e) => e.isPremium === premium)
                  .map((e) => e.key)
              );
            }}
            onToggleColorize={setColorizeEnabled}
            onToggleGrid={setShowGrid}
            onToggleKey={(k) => {
              setSelectedKeys((prev) =>
                prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]
              );
            }}
            onZoom100={() => {
              setZoom(1);
            }}
            onZoomChange={setZoom}
            onZoomFit={() => {
              const el = document.getElementById('viewer-container');
              if (!el) {
                return;
              }
              zoomFit(el.clientWidth, el.clientHeight);
            }}
            paletteEntries={paletteEntries}
            selectedKeys={selectedKeys}
            zoom={zoom}
          />
        </section>
        <section
          className="overflow-hidden rounded-lg border p-0"
          id="viewer-container"
        >
          <div className="h-[min(70vh,70svh)] md:h-full">
            <PixelViewer
              bitmap={result?.bitmap ?? null}
              blockSize={blockSize}
              onRequestFit={zoomFit}
              onZoomChange={setZoom}
              showGrid={showGrid}
              zoom={zoom}
            />
          </div>
        </section>
      </div>
    </div>
  );
}
