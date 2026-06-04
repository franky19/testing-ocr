import Tesseract from 'tesseract.js';
import {BoundingBox, CapturedOverlayFrame} from './interface/ICamera';
import {ImageOcrHelpersOptions} from './type/typeImagesOcrHelper';
import {RecognizeOptions} from './type/typeRecognizeOptions';

export const loadImage = (src: string): Promise<HTMLImageElement> => {
  return new Promise(resolve => {
    const img = new Image();

    img.onload = () => resolve(img);

    img.src = src;
  });
};

export const clampByte = (value: number) => {
  return Math.max(0, Math.min(255, value));
};

export const computeGrayWithContrast = (
  source: Uint8ClampedArray,
  contrast: number,
) => {
  const gray = new Uint8ClampedArray(source.length / 4);

  for (let index = 0; index < gray.length; index += 1) {
    const offset = index * 4;

    const r = source[offset];
    const g = source[offset + 1];
    const b = source[offset + 2];

    const luminance = 0.299 * r + 0.587 * g + 0.114 * b;

    gray[index] = clampByte((luminance - 128) * contrast + 128);
  }

  return gray;
};

export const medianFilterGray = (
  source: Uint8ClampedArray,
  width: number,
  height: number,
) => {
  const output = source.slice();

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const values: number[] = [];

      for (let ny = -1; ny <= 1; ny += 1) {
        for (let nx = -1; nx <= 1; nx += 1) {
          values.push(source[(y + ny) * width + (x + nx)]);
        }
      }

      values.sort((left, right) => left - right);

      output[y * width + x] = values[4];
    }
  }

  return output;
};

const buildAdaptiveIntegralImage = (
  gray: Uint8ClampedArray,
  width: number,
  height: number,
) => {
  const stride = width + 1;
  const integral = new Float64Array((width + 1) * (height + 1));

  for (let y = 1; y <= height; y += 1) {
    let rowSum = 0;

    for (let x = 1; x <= width; x += 1) {
      rowSum += gray[(y - 1) * width + (x - 1)];
      integral[y * stride + x] = integral[(y - 1) * stride + x] + rowSum;
    }
  }

  return integral;
};

const getAdaptiveWindowMean = (
  integral: Float64Array,
  width: number,
  height: number,
  windowSize: number,
  x: number,
  y: number,
) => {
  const stride = width + 1;
  const left = Math.max(0, x - windowSize);
  const right = Math.min(width - 1, x + windowSize);
  const top = Math.max(0, y - windowSize);
  const bottom = Math.min(height - 1, y + windowSize);

  const area = (right - left + 1) * (bottom - top + 1);

  const sum =
    integral[(bottom + 1) * stride + (right + 1)] -
    integral[top * stride + (right + 1)] -
    integral[(bottom + 1) * stride + left] +
    integral[top * stride + left];

  return sum / area;
};

const mapAdaptiveBinary = (
  gray: Uint8ClampedArray,
  width: number,
  height: number,
  integral: Float64Array,
  windowSize: number,
  bias: number,
) => {
  const binary = new Uint8ClampedArray(width * height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixelIndex = y * width + x;
      const localMean = getAdaptiveWindowMean(
        integral,
        width,
        height,
        windowSize,
        x,
        y,
      );

      binary[pixelIndex] = gray[pixelIndex] < localMean - bias ? 0 : 255;
    }
  }

  return binary;
};

export const adaptiveThreshold = (
  gray: Uint8ClampedArray,
  width: number,
  height: number,
) => {
  const integral = buildAdaptiveIntegralImage(gray, width, height);
  const windowSize = Math.max(8, Math.floor(Math.min(width, height) * 0.08));
  const bias = 12;

  return mapAdaptiveBinary(gray, width, height, integral, windowSize, bias);
};

export const morphologyClose = (
  sourceBinary: Uint8ClampedArray,
  width: number,
  height: number,
) => {
  const applyKernel = (
    source: Uint8ClampedArray,
    resolver: (source: Uint8ClampedArray, x: number, y: number) => number,
  ) => {
    const output = source.slice();

    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        output[y * width + x] = resolver(source, x, y);
      }
    }

    return output;
  };

  const hasAnyInkNeighbor = (
    source: Uint8ClampedArray,
    x: number,
    y: number,
  ) => {
    for (let ny = -1; ny <= 1; ny += 1) {
      for (let nx = -1; nx <= 1; nx += 1) {
        if (source[(y + ny) * width + (x + nx)] === 0) {
          return true;
        }
      }
    }

    return false;
  };

  const hasAllInkNeighbor = (
    source: Uint8ClampedArray,
    x: number,
    y: number,
  ) => {
    for (let ny = -1; ny <= 1; ny += 1) {
      for (let nx = -1; nx <= 1; nx += 1) {
        if (source[(y + ny) * width + (x + nx)] !== 0) {
          return false;
        }
      }
    }

    return true;
  };

  // Close = dilate then erode to fill tiny white holes in black text.
  const dilated = applyKernel(sourceBinary, (source, x, y) => {
    return hasAnyInkNeighbor(source, x, y) ? 0 : 255;
  });

  return applyKernel(dilated, (source, x, y) => {
    return hasAllInkNeighbor(source, x, y) ? 0 : 255;
  });
};

export const drawMonochrome = (
  values: Uint8ClampedArray,
  width: number,
  height: number,
) => {
  const canvas = document.createElement('canvas');

  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');

  if (!ctx) {
    return '';
  }

  const imageData = ctx.createImageData(width, height);

  for (let index = 0; index < values.length; index += 1) {
    const offset = index * 4;

    const value = values[index];

    imageData.data[offset] = value;
    imageData.data[offset + 1] = value;
    imageData.data[offset + 2] = value;
    imageData.data[offset + 3] = 255;
  }

  ctx.putImageData(imageData, 0, 0);

  return canvas.toDataURL('image/png', 1);
};

export const cropImageByNormalizedArea = async (
  imageSrc: string,
  area: BoundingBox,
) => {
  const img = await loadImage(imageSrc);

  const cropCanvas = document.createElement('canvas');

  const ctx = cropCanvas.getContext('2d');

  if (!ctx) return imageSrc;

  const cropX = Math.max(0, Math.floor(img.width * area.x));
  const cropY = Math.max(0, Math.floor(img.height * area.y));
  const cropWidth = Math.max(1, Math.floor(img.width * area.width));
  const cropHeight = Math.max(1, Math.floor(img.height * area.height));

  const clampedWidth = Math.max(1, Math.min(cropWidth, img.width - cropX));
  const clampedHeight = Math.max(1, Math.min(cropHeight, img.height - cropY));

  cropCanvas.width = clampedWidth;
  cropCanvas.height = clampedHeight;

  ctx.drawImage(
    img,
    cropX,
    cropY,
    clampedWidth,
    clampedHeight,
    0,
    0,
    clampedWidth,
    clampedHeight,
  );

  return cropCanvas.toDataURL('image/png', 1);
};

export const createImageOcrHelpers = ({
  setProgress,
  getCropAreaFromOverlay,
  visualizeCropArea,
}: ImageOcrHelpersOptions) => {
  const preprocessFullImage = async (imageSrc: string) => {
    const img = await loadImage(imageSrc);

    const canvas = document.createElement('canvas');

    const ctx = canvas.getContext('2d');

    if (!ctx) return imageSrc;

    canvas.width = img.width;
    canvas.height = img.height;

    ctx.drawImage(img, 0, 0);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    const data = imageData.data;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      let gray = 0.299 * r + 0.587 * g + 0.114 * b;

      gray = gray * 1.25;
      gray = gray > 150 ? 255 : 0;

      data[i] = gray;
      data[i + 1] = gray;
      data[i + 2] = gray;
    }

    ctx.putImageData(imageData, 0, 0);

    return canvas.toDataURL('image/png');
  };

  const cropField = async (
    imageSrc: string,
    config: {
      x: number;
      y: number;
      width: number;
      height: number;
      threshold?: number;
      scale?: number;
    },
  ): Promise<string> => {
    const img = await loadImage(imageSrc);

    const canvas = document.createElement('canvas');

    const ctx = canvas.getContext('2d');

    if (!ctx) return imageSrc;

    const scale = config.scale || 4;

    const cropX = img.width * config.x;
    const cropY = img.height * config.y;
    const cropW = img.width * config.width;
    const cropH = img.height * config.height;

    canvas.width = cropW * scale;
    canvas.height = cropH * scale;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    ctx.drawImage(
      img,
      cropX,
      cropY,
      cropW,
      cropH,
      0,
      0,
      canvas.width,
      canvas.height,
    );

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    const data = imageData.data;

    const threshold = config.threshold || 150;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      let gray = 0.299 * r + 0.587 * g + 0.114 * b;

      gray = gray * 1.25;
      gray = gray > threshold ? 255 : 0;

      data[i] = gray;
      data[i + 1] = gray;
      data[i + 2] = gray;
    }

    ctx.putImageData(imageData, 0, 0);

    return canvas.toDataURL('image/png');
  };

  const recognizeText = async (
    image: string,
    lang = 'ind',
    whitelist = '',
    psm = '7',
  ) => {
    const options: RecognizeOptions = {
      logger: m => {
        if (m.status === 'recognizing text') {
          setProgress(Math.floor(m.progress * 100));
        }
      },
      tessedit_pageseg_mode: psm,
      tessedit_char_whitelist: whitelist,
    };

    const result = await Tesseract.recognize(image, lang, options);

    return result.data.text.trim();
  };

  const cleanText = (text: string) => {
    return text
      .replace(/[—=~`]/g, '')
      .replace(/\s+/g, ' ')
      .replaceAll('|', 'I')
      .trim();
  };

  const captureOverlayFrame = (
    video: HTMLVideoElement,
    containerElement: HTMLDivElement,
    overlayBox: BoundingBox,
  ): CapturedOverlayFrame | null => {
    const cropArea = getCropAreaFromOverlay(
      video,
      containerElement,
      overlayBox,
    );

    const containerRect = containerElement.getBoundingClientRect();

    const fullFrameCanvas = document.createElement('canvas');

    fullFrameCanvas.width = video.videoWidth;
    fullFrameCanvas.height = video.videoHeight;

    const fullFrameCtx = fullFrameCanvas.getContext('2d');

    if (fullFrameCtx) {
      fullFrameCtx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);
    }

    const debugOverlayCanvas = visualizeCropArea(
      video,
      containerElement,
      overlayBox,
      cropArea,
    );

    const captureCanvas = document.createElement('canvas');

    captureCanvas.width = cropArea.cropWidth;
    captureCanvas.height = cropArea.cropHeight;

    const captureCtx = captureCanvas.getContext('2d');

    if (!captureCtx) return null;

    captureCtx.imageSmoothingEnabled = false;

    captureCtx.drawImage(
      video,
      cropArea.cropX,
      cropArea.cropY,
      cropArea.cropWidth,
      cropArea.cropHeight,
      0,
      0,
      cropArea.cropWidth,
      cropArea.cropHeight,
    );

    return {
      imageSrc: captureCanvas.toDataURL('image/png', 1),
      cameraDebugData: {
        fullFrameImage: fullFrameCanvas.toDataURL('image/png', 1),
        overlayDebugImage:
          debugOverlayCanvas?.toDataURL('image/png', 1) ||
          fullFrameCanvas.toDataURL('image/png', 1),
        cropArea,
        overlayBox,
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
        containerWidth: Math.round(containerRect.width),
        containerHeight: Math.round(containerRect.height),
      },
    };
  };

  return {
    preprocessFullImage,
    cropField,
    recognizeText,
    cleanText,
    captureOverlayFrame,
  };
};
