import Tesseract from 'tesseract.js';
import {CropRect, ViewportMapping} from './ocr.type';

export const DEBUG_OVERLAY = false;

export const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

export const loadImageFromSource = (
  imageSrc: string,
): Promise<HTMLImageElement> => {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(new Error('Failed to load image for overlay crop.'));
    image.src = imageSrc;
  });
};

export function calculateCropFromViewport(
  videoWidth: number,
  videoHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  overlayRect: {
    left: number;
    top: number;
    width: number;
    height: number;
  },
): CropRect {
  const scale = Math.max(
    viewportWidth / videoWidth,
    viewportHeight / videoHeight,
  );
  const renderedWidth = videoWidth * scale;
  const renderedHeight = videoHeight * scale;
  const offsetX = (viewportWidth - renderedWidth) / 2;
  const offsetY = (viewportHeight - renderedHeight) / 2;

  const sourceX1 = (overlayRect.left - offsetX) / scale;
  const sourceY1 = (overlayRect.top - offsetY) / scale;
  const sourceX2 = (overlayRect.left + overlayRect.width - offsetX) / scale;
  const sourceY2 = (overlayRect.top + overlayRect.height - offsetY) / scale;

  const clampedX1 = clamp(sourceX1, 0, videoWidth);
  const clampedY1 = clamp(sourceY1, 0, videoHeight);
  const clampedX2 = clamp(sourceX2, 0, videoWidth);
  const clampedY2 = clamp(sourceY2, 0, videoHeight);

  return {
    sourceX: clampedX1,
    sourceY: clampedY1,
    sourceWidth: Math.max(1, clampedX2 - clampedX1),
    sourceHeight: Math.max(1, clampedY2 - clampedY1),
  };
}

export const calculateViewportMapping = ({
  videoWidth,
  videoHeight,
  imageWidth,
  imageHeight,
  viewportWidth,
  viewportHeight,
  overlayRect,
}: {
  videoWidth: number;
  videoHeight: number;
  imageWidth: number;
  imageHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  overlayRect: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
}): ViewportMapping => {
  const scale = Math.max(
    viewportWidth / videoWidth,
    viewportHeight / videoHeight,
  );
  const renderedWidth = videoWidth * scale;
  const renderedHeight = videoHeight * scale;
  const offsetX = (viewportWidth - renderedWidth) / 2;
  const offsetY = (viewportHeight - renderedHeight) / 2;

  const videoCrop = calculateCropFromViewport(
    videoWidth,
    videoHeight,
    viewportWidth,
    viewportHeight,
    overlayRect,
  );

  const normalizedX = videoCrop.sourceX / videoWidth;
  const normalizedY = videoCrop.sourceY / videoHeight;
  const normalizedX2 = (videoCrop.sourceX + videoCrop.sourceWidth) / videoWidth;
  const normalizedY2 =
    (videoCrop.sourceY + videoCrop.sourceHeight) / videoHeight;

  const sourceX1 = clamp(normalizedX * imageWidth, 0, imageWidth);
  const sourceY1 = clamp(normalizedY * imageHeight, 0, imageHeight);
  const sourceX2 = clamp(normalizedX2 * imageWidth, 0, imageWidth);
  const sourceY2 = clamp(normalizedY2 * imageHeight, 0, imageHeight);

  const clampedX1 = sourceX1;
  const clampedY1 = sourceY1;
  const clampedX2 = sourceX2;
  const clampedY2 = sourceY2;

  return {
    videoWidth,
    videoHeight,
    imageWidth,
    imageHeight,
    viewportWidth,
    viewportHeight,
    overlayLeft: overlayRect.left,
    overlayTop: overlayRect.top,
    overlayWidth: overlayRect.width,
    overlayHeight: overlayRect.height,
    renderedWidth,
    renderedHeight,
    scale,
    offsetX,
    offsetY,
    normalizedX,
    normalizedY,
    normalizedWidth: Math.max(0, normalizedX2 - normalizedX),
    normalizedHeight: Math.max(0, normalizedY2 - normalizedY),
    sourceX: clampedX1,
    sourceY: clampedY1,
    sourceWidth: Math.max(1, clampedX2 - clampedX1),
    sourceHeight: Math.max(1, clampedY2 - clampedY1),
  };
};

export const cropImageToOverlay = async (
  imageSrc: string,
  cropRect: CropRect,
): Promise<string> => {
  const image = await loadImageFromSource(imageSrc);
  const canvas = document.createElement('canvas');

  canvas.width = Math.round(cropRect.sourceWidth);
  canvas.height = Math.round(cropRect.sourceHeight);

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Failed to create canvas context for overlay crop.');
  }

  context.drawImage(
    image,
    cropRect.sourceX,
    cropRect.sourceY,
    cropRect.sourceWidth,
    cropRect.sourceHeight,
    0,
    0,
    canvas.width,
    canvas.height,
  );

  return canvas.toDataURL('image/jpeg', 0.95);
};

export const runOCR = async ({
  imageSrc,
  setProgress,
}: {
  imageSrc: string;
  setProgress: React.Dispatch<React.SetStateAction<number>>;
}) => {
  const result = await Tesseract.recognize(imageSrc, 'eng', {
    logger: message => {
      if (message.status === 'recognizing text') {
        setProgress(Math.round(message.progress * 100));
      }
    },
  });

  return result.data.text;
};
