export type DecodedImage = {
  bitmap: ImageBitmap;
  width: number;
  height: number;
};

const MAX_DIMENSION = 4096; // cap very large images for safety/perf

export async function decodeFileToBitmap(file: File): Promise<DecodedImage> {
  const bitmap = await createImageBitmap(file);

  const { width, height } = constrainDimensions(bitmap.width, bitmap.height);
  if (width !== bitmap.width || height !== bitmap.height) {
    // downscale to safe size via OffscreenCanvas if needed
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return { bitmap, width: bitmap.width, height: bitmap.height };
    }
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(bitmap, 0, 0, width, height);
    const scaled = canvas.transferToImageBitmap();
    return { bitmap: scaled, width, height };
  }
  return { bitmap, width, height };
}

export function constrainDimensions(width: number, height: number) {
  if (width <= MAX_DIMENSION && height <= MAX_DIMENSION) {
    return { width, height };
  }
  const scale = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height);
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
  };
}
