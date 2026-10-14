/**
 * Downscaling a photo before it is uploaded, shared by the merchant's packing
 * photo (QC-2) and the buyer's claim photo (QC-3).
 *
 * A phone sensor produces several megabytes the server would only shrink again,
 * so the browser does it first. That is a courtesy, not a control: the backend
 * re-encodes every upload and strips its metadata whatever this sends. Drawing
 * to a canvas also drops the EXIF block in the browser, but nothing relies on it.
 */

export const PHOTO_MAX_EDGE = 1600;

/** Draw an image source to a canvas no larger than `maxEdge` and return it as a JPEG data URL. */
export function toJpegDataUrl(
  source: CanvasImageSource,
  width: number,
  height: number,
  maxEdge: number = PHOTO_MAX_EDGE,
): string {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  canvas.getContext("2d")!.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85);
}

/** A chosen or captured file as a downscaled JPEG data URL, with the camera's orientation applied. */
export async function fileToJpegDataUrl(file: File, maxEdge: number = PHOTO_MAX_EDGE): Promise<string> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    return toJpegDataUrl(bitmap, bitmap.width, bitmap.height, maxEdge);
  } finally {
    bitmap.close();
  }
}
