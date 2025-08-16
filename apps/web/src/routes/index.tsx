import { createFileRoute } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PixelViewer } from '@/components/pixel-viewer';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { decodeFileToBitmap } from '@/lib/image';
import { PALETTE_ENTRIES } from '@/lib/palette';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Upload, Download, ZoomIn, ZoomOut, ImageIcon, Palette } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
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

function hexToRgbaComponents(
  hex: string
): [number, number, number, number] | null {
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

function toReadableName(key: string): string {
  // Split into words and convert to Title Case
  const spaced = key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
  return spaced.replace(/\b\w/g, (c) => c.toUpperCase());
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
  const showGrid = true;
  const [colorizeEnabled, setColorizeEnabled] = useState(true);
  const [selectedKeys, setSelectedKeys] = useState<string[]>(() =>
    PALETTE_ENTRIES.map((e) => String(e.key))
  );
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    // Using import.meta.url provides the absolute URL of the current module,
    // which is essential for resolving the relative path '../workers/pixelate.worker.ts'
    // correctly regardless of where this code is bundled or executed.
    //
    // Without import.meta.url, the relative path would be resolved relative to
    // the document's base URL, which could be incorrect in bundled environments.
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

  const selectedPaletteArray = useMemo(() => {
    const selected = new Set(selectedKeys);
    const out: number[] = [];
    for (const e of PALETTE_ENTRIES) {
      if (!selected.has(String(e.key))) {
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
  }, [selectedKeys]);

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

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      if (!f || !f.type.startsWith('image/')) {
        return;
      }
      void handleFile(f);
    },
    []
  );

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const files = e.dataTransfer.files;
    if (files.length === 0) {
      return;
    }
    const file = files[0];
    if (!file.type.startsWith('image/')) {
      return;
    }
    void handleFile(file);
  }, []);

  function handleBlockSizeChange(v: number) {
    setBlockSize(v);
  }

  const zoomFit = useCallback(
    (containerW: number, containerH: number) => {
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
    },
    [bitmap, result]
  );

  function onDownload() {
    if (!result) {
      return;
    }
    workerRef.current?.postMessage({ type: 'generateBlob', jobId });
  }

  // Re-run processing when inputs change (block size, palette) and a bitmap is loaded
  useEffect(() => {
    if (bitmap) {
      startProcess(blockSize, bitmap, false);
    }
  }, [bitmap, blockSize, selectedKeys, startProcess]);

  return (
    <div className="container mx-auto h-full px-4 py-6">
      <div className="space-y-6">
        <div className="text-center space-y-1">
          <h1 className="text-3xl font-bold">Pixel Art Converter</h1>
          <p className="text-muted-foreground text-sm">
            Transform your images into pixel art with customizable palettes
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          <div className="md:col-span-1 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ImageIcon className="size-5" /> Upload Image
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div
                  className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary transition-colors"
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                >
                  <Upload className="size-12 mx-auto mb-4 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground mb-2">
                    Drag & drop an image here, or click to select
                  </p>
                  <Button type="button" variant="outline" size="sm">
                    Choose File
                  </Button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleFileInputChange}
                    className="hidden"
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Block Size: {blockSize}px</CardTitle>
              </CardHeader>
              <CardContent>
                <Slider
                  value={[blockSize]}
                  min={1}
                  max={32}
                  step={1}
                  onValueChange={(v) => handleBlockSizeChange(Number(v[0]))}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>Zoom: {Math.round(zoom * 100)}%</span>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setZoom((z) => Math.max(0.25, Number((z / 1.25).toFixed(2))))}
                    >
                      <ZoomOut className="size-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setZoom((z) => Math.min(8, Number((z * 1.25).toFixed(2))))}
                    >
                      <ZoomIn className="size-4" />
                    </Button>
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Slider
                  value={[zoom] as unknown as number[]}
                  min={0.25}
                  max={8}
                  step={0.05}
                  onValueChange={(v) => setZoom(Number(v[0]))}
                />
                <div className="mt-2 flex gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      const el = document.getElementById('viewer-container');
                      if (!el) return;
                      zoomFit(el.clientWidth, el.clientHeight);
                    }}
                  >
                    Fit
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setZoom(1)}
                  >
                    100%
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Palette className="size-5" /> Color Palettes
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between mb-4">
                  <span>Colorize with palette</span>
                  <Button
                    type="button"
                    size="sm"
                    variant={colorizeEnabled ? 'secondary' : 'outline'}
                    onClick={() => setColorizeEnabled((v) => !v)}
                  >
                    {colorizeEnabled ? 'On' : 'Off'}
                  </Button>
                </div>
                {colorizeEnabled ? (
                  <>
                    <div className="flex flex-wrap items-center gap-2 mb-4">
                      <span className="text-xs">Bulk:</span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setSelectedKeys(PALETTE_ENTRIES.map((e) => String(e.key)))}
                      >
                        Select all
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setSelectedKeys(
                            PALETTE_ENTRIES.filter((e) => !e.isPremium).map((e) => String(e.key))
                          )
                        }
                      >
                        Only free
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setSelectedKeys(
                            PALETTE_ENTRIES.filter((e) => e.isPremium).map((e) => String(e.key))
                          )
                        }
                      >
                        Only premium
                      </Button>
                    </div>

                    <div className="grid gap-4">
                      <div>
                        <h3 className="font-medium mb-2">Free Colors</h3>
                        <ScrollArea className="h-28 rounded border p-2">
                          <div className="grid grid-cols-12 gap-2">
                            {PALETTE_ENTRIES.filter((e) => !e.isPremium).map((p) => {
                              const isSelected = selectedKeys.includes(String(p.key));
                              const label = toReadableName(String(p.key));
                              return (
                                <Tooltip key={p.key}>
                                  <TooltipTrigger asChild>
                                    <button
                                      type="button"
                                      aria-label={`Toggle ${label}`}
                                      aria-pressed={isSelected}
                                      onClick={() =>
                                        setSelectedKeys((prev) =>
                                          prev.includes(String(p.key))
                                            ? prev.filter((x) => x !== String(p.key))
                                            : [...prev, String(p.key)]
                                        )
                                      }
                                      className={`h-6 w-6 rounded border ${
                                        isSelected
                                          ? 'border-primary'
                                          : 'border-border opacity-30 hover:opacity-75'
                                      }`}
                                      style={{ backgroundColor: p.hex }}
                                    />
                                  </TooltipTrigger>
                                  <TooltipContent>{label}</TooltipContent>
                                </Tooltip>
                              );
                            })}
                          </div>
                        </ScrollArea>
                      </div>
                      <div>
                        <h3 className="font-medium mb-2">Premium Colors</h3>
                        <ScrollArea className="h-28 rounded border p-2">
                          <div className="grid grid-cols-12 gap-2">
                            {PALETTE_ENTRIES.filter((e) => e.isPremium).map((p) => {
                              const isSelected = selectedKeys.includes(String(p.key));
                              const label = toReadableName(String(p.key));
                              return (
                                <Tooltip key={p.key}>
                                  <TooltipTrigger asChild>
                                    <button
                                      type="button"
                                      aria-label={`Toggle ${label}`}
                                      aria-pressed={isSelected}
                                      onClick={() =>
                                        setSelectedKeys((prev) =>
                                          prev.includes(String(p.key))
                                            ? prev.filter((x) => x !== String(p.key))
                                            : [...prev, String(p.key)]
                                        )
                                      }
                                      className={`h-6 w-6 rounded border ${
                                        isSelected
                                          ? 'border-primary'
                                          : 'border-border opacity-30 hover:opacity-75'
                                      }`}
                                      style={{ backgroundColor: p.hex }}
                                    />
                                  </TooltipTrigger>
                                  <TooltipContent>{label}</TooltipContent>
                                </Tooltip>
                              );
                            })}
                          </div>
                        </ScrollArea>
                      </div>
                    </div>
                  </>
                ) : null}
              </CardContent>
            </Card>

            <Button
              type="button"
              className="w-full"
              size="lg"
              disabled={!result || isProcessing}
              onClick={onDownload}
            >
              <Download className="size-4 mr-2" /> Download Pixel Art
            </Button>
          </div>

          <div className="md:col-span-2">
            <Card className="h-full">
              <CardHeader>
                <CardTitle>Preview</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <section
                  id="viewer-container"
                  className="relative overflow-hidden rounded-b-xl"
                >
                  <div className="h-[min(70vh,70svh)] md:h-[70vh]">
                    <PixelViewer
                      bitmap={result?.bitmap ?? null}
                      blockSize={blockSize}
                      onRequestFit={zoomFit}
                      onZoomChange={setZoom}
                      showGrid={showGrid}
                      zoom={zoom}
                    />
                  </div>
                  {!bitmap ? (
                    <div className="absolute inset-0 grid place-items-center p-8 text-center text-muted-foreground">
                      <div>
                        <ImageIcon className="size-16 mx-auto mb-4 opacity-50" />
                        <p>Upload an image to see the pixel art preview</p>
                      </div>
                    </div>
                  ) : null}
                </section>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Palette controls moved to the left column */}
      </div>
    </div>
  );
}
