import {
  type CSSProperties,
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

export type PixelViewerProps = {
  bitmap: ImageBitmap | null;
  zoom: number;
  onZoomChange: (z: number) => void;
  onRequestFit: (containerW: number, containerH: number) => void;
  showGrid?: boolean;
  blockSize?: number;
};

export function PixelViewer({
  bitmap,
  zoom,
  onZoomChange,
  onRequestFit,
  showGrid = false,
  blockSize = 16,
}: PixelViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [pan, setPan] = useState({ x: 0, y: 0 });
  const isPointerDown = useRef(false);
  const lastPt = useRef({ x: 0, y: 0 });
  const ZOOM_PRECISION = 2;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }
    if (!bitmap) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0);
  }, [bitmap]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) {
      return;
    }
    if (!bitmap) {
      return;
    }
    onRequestFit(el.clientWidth, el.clientHeight);
  }, [bitmap, onRequestFit]);

  function handleWheel(e: React.WheelEvent<HTMLDivElement>) {
    if (!bitmap) {
      return;
    }
    e.preventDefault();
    const MIN_ZOOM = 0.25;
    const MAX_ZOOM = 8;
    const ZOOM_FACTOR = 1.1;
    const factor = e.deltaY > 0 ? 1 / ZOOM_FACTOR : ZOOM_FACTOR;
    const next = Math.min(
      MAX_ZOOM,
      Math.max(MIN_ZOOM, Number((zoom * factor).toFixed(ZOOM_PRECISION)))
    );
    onZoomChange(next);
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    isPointerDown.current = true;
    lastPt.current = { x: e.clientX, y: e.clientY };
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!isPointerDown.current) {
      return;
    }
    const dx = e.clientX - lastPt.current.x;
    const dy = e.clientY - lastPt.current.y;
    lastPt.current = { x: e.clientX, y: e.clientY };
    setPan((p) => ({ x: p.x + dx, y: p.y + dy }));
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    isPointerDown.current = false;
  }

  // Clamp panning so image cannot be dragged outside viewer
  const clampedPan = useMemo(() => {
    const el = containerRef.current;
    const cw = el?.clientWidth ?? 0;
    const ch = el?.clientHeight ?? 0;
    const w = (bitmap?.width ?? 0) * zoom;
    const h = (bitmap?.height ?? 0) * zoom;
    if (cw === 0 || ch === 0 || w === 0 || h === 0) {
      return pan;
    }
    const maxX = Math.max(0, (w - cw) / 2);
    const maxY = Math.max(0, (h - ch) / 2);
    return {
      x: Math.max(-maxX, Math.min(maxX, pan.x)),
      y: Math.max(-maxY, Math.min(maxY, pan.y)),
    };
  }, [pan, zoom, bitmap]);

  const transform = useMemo(
    () => `translate(${clampedPan.x}px, ${clampedPan.y}px) scale(${zoom})`,
    [clampedPan.x, clampedPan.y, zoom]
  );

  const zoomForOverlay = zoom;

  return (
    <section
      aria-label="Pixel art preview. Use mouse to pan. Use mouse wheel to zoom."
      className="relative h-full w-full overflow-hidden bg-accent/20"
      onPointerCancel={handlePointerUp}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onWheel={handleWheel}
      ref={containerRef}
    >
      <div
        className="relative grid h-full w-full place-items-center"
        style={{ transform, willChange: 'transform' }}
      >
        {bitmap ? (
          <div
            className="relative"
            style={{ width: bitmap.width, height: bitmap.height }}
          >
            <canvas
              className="block select-none"
              ref={canvasRef}
              style={{
                imageRendering: 'pixelated' as CSSProperties['imageRendering'],
              }}
            />
            {showGrid ? (
              <GridSvgOverlay
                gridBlockSize={blockSize}
                gridHeight={bitmap.height}
                gridWidth={bitmap.width}
                viewZoom={zoomForOverlay}
              />
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

type GridOverlayProps = {
  gridWidth: number;
  gridHeight: number;
  gridBlockSize: number;
  viewZoom: number;
};

const GridSvgOverlay = memo(
  ({
    gridWidth: gwOuter,
    gridHeight: ghOuter,
    gridBlockSize: gbsOuter,
    viewZoom: gridZoomOuter,
  }: GridOverlayProps) => {
    const cols = Math.ceil(gwOuter / gbsOuter);
    const rows = Math.ceil(ghOuter / gbsOuter);
    const stroke = 1 / gridZoomOuter; // constant 1px screen lines
    const lineElems: React.ReactNode[] = [];
    for (let c = 1; c < cols; c++) {
      const vx = c * gbsOuter;
      lineElems.push(
        <line
          key={`v-${c}`}
          stroke="rgba(255,255,255,0.25)"
          strokeWidth={stroke}
          x1={vx}
          x2={vx}
          y1={0}
          y2={ghOuter}
        />
      );
    }
    for (let r = 1; r < rows; r++) {
      const vy = r * gbsOuter;
      lineElems.push(
        <line
          key={`h-${r}`}
          stroke="rgba(255,255,255,0.25)"
          strokeWidth={stroke}
          x1={0}
          x2={gwOuter}
          y1={vy}
          y2={vy}
        />
      );
    }
    return (
      <svg
        aria-hidden
        className="pointer-events-none absolute"
        height={ghOuter}
        style={{ left: 0, top: 0 }}
        viewBox={`0 0 ${gwOuter} ${ghOuter}`}
        width={gwOuter}
      >
        <title>Grid overlay</title>
        {lineElems}
      </svg>
    );
  }
);
