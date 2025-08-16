import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 8;
const ZOOM_STEP = 1.25;
const ZOOM_FINE_STEP = 0.05;
const DEFAULT_BLOCK_SIZE = 16;
const PRECISION_FOR_ZOOM = 2;
const ZOOM_PERCENT = 100;

function roundZoom(value: number) {
  const factor = 10 ** PRECISION_FOR_ZOOM;
  return Math.round(value * factor) / factor;
}

export type PixelControlsProps = {
  disabled?: boolean;
  blockSize: number;
  onBlockSizeChange: (value: number) => void;
  onFileSelected: (file: File) => void;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  onZoomFit: () => void;
  onZoom100: () => void;
  meta?: {
    outWidth: number;
    outHeight: number;
    tilesX: number;
    tilesY: number;
    totalPixels: number;
  };
  onDownload: () => void;
  gridEnabled?: boolean;
  onToggleGrid?: (v: boolean) => void;
  colorizeEnabled?: boolean;
  onToggleColorize?: (v: boolean) => void;
  paletteEntries?: Array<{ key: string; hex: string; isPremium: boolean }>;
  selectedKeys?: string[];
  onToggleKey?: (k: string) => void;
  onSelectAll?: (premium: boolean | 'all') => void;
  /**
   * When false, hides the palette controls section entirely.
   * Defaults to true to preserve existing behavior for other pages.
   */
  showPaletteControls?: boolean;
};

export function PixelControls(props: PixelControlsProps) {
  const {
    disabled,
    blockSize,
    onBlockSizeChange,
    onFileSelected,
    zoom,
    onZoomChange,
    onZoomFit,
    onZoom100,
    meta,
    onDownload,
  } = props;
  const colorizeEnabled = props.colorizeEnabled ?? true;
  const showPaletteControls = props.showPaletteControls ?? true;

  const [internalBlockSize, setInternalBlockSize] = useState([blockSize]);
  useEffect(() => {
    setInternalBlockSize([blockSize]);
  }, [blockSize]);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) {
      return;
    }
    if (!f.type.startsWith('image/')) {
      toast.error('Please select an image file');
      return;
    }
    onFileSelected(f);
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="file">Source image</Label>
        <Input
          accept="image/*"
          disabled={disabled}
          id="file"
          onChange={handleFileChange}
          type="file"
        />
      </div>

      <Separator />

      <div className="grid gap-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="blockSize">Block size</Label>
          <span className="text-muted-foreground text-xs">{blockSize}px</span>
        </div>
        <Slider
          disabled={disabled}
          id="blockSize"
          max={32}
          min={1}
          onValueChange={(v) => setInternalBlockSize(v)}
          onValueCommit={(v) => onBlockSizeChange(v[0] ?? DEFAULT_BLOCK_SIZE)}
          step={1}
          value={internalBlockSize}
        />
      </div>

      <div className="grid gap-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="zoom">Zoom</Label>
          <span className="text-muted-foreground text-xs">
            {Math.round(zoom * ZOOM_PERCENT)}%
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={() =>
              onZoomChange(Math.max(MIN_ZOOM, roundZoom(zoom / ZOOM_STEP)))
            }
            size="sm"
            type="button"
            variant="outline"
          >
            -
          </Button>
          <Slider
            id="zoom"
            max={MAX_ZOOM}
            min={MIN_ZOOM}
            onValueChange={(v) => onZoomChange(Number(v[0]))}
            step={ZOOM_FINE_STEP}
            value={[zoom] as unknown as number[]}
          />
          <Button
            onClick={() => {
              onZoomChange(Math.min(MAX_ZOOM, roundZoom(zoom * ZOOM_STEP)));
            }}
            size="sm"
            type="button"
            variant="outline"
          >
            +
          </Button>
        </div>
        <div className="flex gap-2">
          <Button onClick={onZoomFit} size="sm" type="button" variant="ghost">
            Fit
          </Button>
          <Button onClick={onZoom100} size="sm" type="button" variant="ghost">
            100%
          </Button>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Label htmlFor="grid">Grid</Label>
          </div>
          <Button
            onClick={() => props.onToggleGrid?.(!props.gridEnabled)}
            size="sm"
            type="button"
            variant={props.gridEnabled ? 'secondary' : 'outline'}
          >
            {props.gridEnabled ? 'On' : 'Off'}
          </Button>
        </div>
      </div>

      {showPaletteControls ? (
        <>
          <Separator />

          <div className="grid gap-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="colorize">Colorize with palette</Label>
              <Button
                onClick={() => props.onToggleColorize?.(!colorizeEnabled)}
                size="sm"
                type="button"
                variant={colorizeEnabled ? 'secondary' : 'outline'}
              >
                {colorizeEnabled ? 'On' : 'Off'}
              </Button>
            </div>
            {colorizeEnabled ? (
              <div className="grid gap-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground text-xs">Bulk</span>
                  <div className="flex gap-2">
                    <Button
                      onClick={() => props.onSelectAll?.('all')}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      Select all
                    </Button>
                    <Button
                      onClick={() => props.onSelectAll?.(false)}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      Only free
                    </Button>
                    <Button
                      onClick={() => props.onSelectAll?.(true)}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      Only premium
                    </Button>
                  </div>
                </div>
                <div className="grid gap-2">
                  <div className="font-medium text-xs">Free colors</div>
                  <ScrollArea className="h-28 rounded border p-2">
                    <div className="grid grid-cols-2 gap-2">
                      {props.paletteEntries
                        ?.filter((p) => !p.isPremium)
                        .map((p) => {
                          const checked =
                            props.selectedKeys?.includes(p.key) ?? false;
                          return (
                            <label
                              className="flex cursor-pointer items-center gap-2 text-xs"
                              htmlFor={`free-${p.key}`}
                              key={p.key}
                            >
                              <Checkbox
                                checked={checked}
                                id={`free-${p.key}`}
                                onCheckedChange={() => props.onToggleKey?.(p.key)}
                              />
                              <span
                                aria-hidden
                                className="inline-block h-3 w-3 rounded"
                                style={{ backgroundColor: p.hex }}
                              />
                              <span className="truncate">{p.key}</span>
                            </label>
                          );
                        })}
                    </div>
                  </ScrollArea>
                </div>
                <div className="grid gap-2">
                  <div className="font-medium text-xs">Premium colors</div>
                  <ScrollArea className="h-28 rounded border p-2">
                    <div className="grid grid-cols-2 gap-2">
                      {props.paletteEntries
                        ?.filter((p) => p.isPremium)
                        .map((p) => {
                          const checked =
                            props.selectedKeys?.includes(p.key) ?? false;
                          return (
                            <label
                              className="flex cursor-pointer items-center gap-2 text-xs"
                              htmlFor={`prem-${p.key}`}
                              key={p.key}
                            >
                              <Checkbox
                                checked={checked}
                                id={`prem-${p.key}`}
                                onCheckedChange={() => props.onToggleKey?.(p.key)}
                              />
                              <span
                                aria-hidden
                                className="inline-block h-3 w-3 rounded"
                                style={{ backgroundColor: p.hex }}
                              />
                              <span className="truncate">{p.key}</span>
                            </label>
                          );
                        })}
                    </div>
                  </ScrollArea>
                </div>
              </div>
            ) : null}
          </div>
        </>
      ) : null}

      <Separator />

      <div className="grid gap-1 text-sm">
        <div className="flex items-center justify-between">
          <span>Output width</span>
          <span className="font-medium text-primary">
            {meta?.outWidth ?? '-'}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span>Output height</span>
          <span className="font-medium text-primary">
            {meta?.outHeight ?? '-'}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span>Tiles</span>
          <span className="font-medium text-primary">
            {meta ? `${meta.tilesX} × ${meta.tilesY}` : '-'}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span>Total pixels</span>
          <span className="font-medium text-primary">
            {meta?.totalPixels ?? '-'}
          </span>
        </div>
      </div>

      <div className="pt-2">
        <Button disabled={disabled} onClick={onDownload} type="button">
          Download PNG
        </Button>
      </div>
    </div>
  );
}
