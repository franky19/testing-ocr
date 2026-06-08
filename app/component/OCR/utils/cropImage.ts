import {loadImageElement, Rect} from './imageDimensions';

export const cropImageFromBase64 = async (
  imageSrc: string,
  cropRect: Rect,
): Promise<string> => {
  const sourceImage = await loadImageElement(imageSrc);
  const canvas = document.createElement('canvas');

  canvas.width = Math.max(1, Math.floor(cropRect.width));
  canvas.height = Math.max(1, Math.floor(cropRect.height));

  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('Canvas 2D context is not available.');
  }

  context.drawImage(
    sourceImage,
    cropRect.x,
    cropRect.y,
    cropRect.width,
    cropRect.height,
    0,
    0,
    canvas.width,
    canvas.height,
  );

  return canvas.toDataURL('image/jpeg', 0.95);
};
