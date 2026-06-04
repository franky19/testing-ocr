type GrayData = Uint8ClampedArray;
type BinaryData = Uint8Array;

const clamp = (value: number, min: number, max: number) => {
  return Math.max(min, Math.min(max, value));
};

const loadImage = async (imageSrc: string) => {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      resolve(image);
    };
    image.onerror = reject;
    image.src = imageSrc;
  });
};

const createCanvas = (width: number, height: number) => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d', {willReadFrequently: true});

  if (!ctx) {
    throw new Error('Canvas context unavailable for camera NIK pipeline');
  }

  return {canvas, ctx};
};

const toGray = (rgba: Uint8ClampedArray) => {
  const gray = new Uint8ClampedArray(rgba.length / 4);

  for (
    let sourceIndex = 0, grayIndex = 0;
    sourceIndex < rgba.length;
    sourceIndex += 4, grayIndex += 1
  ) {
    const red = rgba[sourceIndex];
    const green = rgba[sourceIndex + 1];
    const blue = rgba[sourceIndex + 2];

    gray[grayIndex] = Math.round(0.299 * red + 0.587 * green + 0.114 * blue);
  }

  return gray;
};

const integralImage = (input: GrayData, width: number, height: number) => {
  const integral = new Float64Array((width + 1) * (height + 1));
  const integralSq = new Float64Array((width + 1) * (height + 1));

  for (let y = 1; y <= height; y += 1) {
    let rowSum = 0;
    let rowSqSum = 0;

    for (let x = 1; x <= width; x += 1) {
      const pixel = input[(y - 1) * width + (x - 1)];
      rowSum += pixel;
      rowSqSum += pixel * pixel;

      const integralIndex = y * (width + 1) + x;
      const upperIndex = (y - 1) * (width + 1) + x;

      integral[integralIndex] = integral[upperIndex] + rowSum;
      integralSq[integralIndex] = integralSq[upperIndex] + rowSqSum;
    }
  }

  return {integral, integralSq};
};

const regionSum = (
  integral: Float64Array,
  width: number,
  left: number,
  top: number,
  right: number,
  bottom: number,
) => {
  const stride = width + 1;

  const a = top * stride + left;
  const b = top * stride + (right + 1);
  const c = (bottom + 1) * stride + left;
  const d = (bottom + 1) * stride + (right + 1);

  return integral[d] - integral[b] - integral[c] + integral[a];
};

const localContrastEnhance = (
  input: GrayData,
  width: number,
  height: number,
) => {
  const output = new Uint8ClampedArray(input.length);
  const {integral, integralSq} = integralImage(input, width, height);
  const radius = 9;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const left = Math.max(0, x - radius);
      const right = Math.min(width - 1, x + radius);
      const top = Math.max(0, y - radius);
      const bottom = Math.min(height - 1, y + radius);
      const area = (right - left + 1) * (bottom - top + 1);

      const sum = regionSum(integral, width, left, top, right, bottom);
      const sqSum = regionSum(integralSq, width, left, top, right, bottom);
      const mean = sum / area;
      const variance = Math.max(0, sqSum / area - mean * mean);
      const stdDev = Math.sqrt(variance);

      const pixel = input[y * width + x];
      const normalized = (pixel - mean) / (stdDev + 12);
      const adjusted = pixel + normalized * 42 + (mean > 160 ? 10 : 0);

      output[y * width + x] = clamp(Math.round(adjusted), 0, 255);
    }
  }

  return output;
};

const removeHorizontalLines = (
  input: GrayData,
  width: number,
  height: number,
) => {
  const output = new Uint8ClampedArray(input);
  let removedPixels = 0;
  let removedLines = 0;
  const isLargeFrame = width >= 2500 || height >= 1500;
  const darkThreshold = isLargeFrame ? 112 : 120;
  const darkRatioThreshold = isLargeFrame ? 0.68 : 0.6;
  const maxLineThickness = isLargeFrame ? 1 : 2;

  let y = 0;
  while (y < height) {
    let darkCount = 0;

    for (let x = 0; x < width; x += 1) {
      if (output[y * width + x] < darkThreshold) {
        darkCount += 1;
      }
    }

    if (darkCount <= Math.floor(width * darkRatioThreshold)) {
      y += 1;
      continue;
    }

    let endY = y;
    while (endY + 1 < height) {
      let nextDarkCount = 0;
      for (let x = 0; x < width; x += 1) {
        if (output[(endY + 1) * width + x] < darkThreshold) {
          nextDarkCount += 1;
        }
      }

      if (nextDarkCount > Math.floor(width * darkRatioThreshold)) {
        endY += 1;
      } else {
        break;
      }
    }

    const thickness = endY - y + 1;

    if (thickness <= maxLineThickness) {
      for (let row = y; row <= endY; row += 1) {
        for (let x = 0; x < width; x += 1) {
          const index = row * width + x;
          if (output[index] < 245) {
            output[index] = 255;
            removedPixels += 1;
          }
        }
      }
      removedLines += 1;
    }

    y = endY + 1;
  }

  return {
    output,
    removedPixels,
    removedLines,
  };
};

const medianFilter3x3Gray = (
  input: GrayData,
  width: number,
  height: number,
) => {
  const output = new Uint8ClampedArray(input.length);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const values: number[] = [];

      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          const sampleX = clamp(x + offsetX, 0, width - 1);
          const sampleY = clamp(y + offsetY, 0, height - 1);
          values.push(input[sampleY * width + sampleX]);
        }
      }

      values.sort((left, right) => left - right);
      output[y * width + x] = values[4];
    }
  }

  return output;
};

const sauvolaThreshold = (input: GrayData, width: number, height: number) => {
  const output = new Uint8Array(input.length);
  const {integral, integralSq} = integralImage(input, width, height);
  const windowRadius = 15;
  const k = 0.34;
  const dynamicRange = 128;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const left = Math.max(0, x - windowRadius);
      const right = Math.min(width - 1, x + windowRadius);
      const top = Math.max(0, y - windowRadius);
      const bottom = Math.min(height - 1, y + windowRadius);
      const area = (right - left + 1) * (bottom - top + 1);

      const sum = regionSum(integral, width, left, top, right, bottom);
      const sqSum = regionSum(integralSq, width, left, top, right, bottom);
      const mean = sum / area;
      const variance = Math.max(0, sqSum / area - mean * mean);
      const stdDev = Math.sqrt(variance);

      const threshold = mean * (1 + k * (stdDev / dynamicRange - 1));
      output[y * width + x] = input[y * width + x] <= threshold ? 1 : 0;
    }
  }

  return output;
};

const otsuThreshold = (input: GrayData) => {
  const histogram = new Uint32Array(256);

  for (let index = 0; index < input.length; index += 1) {
    histogram[input[index]] += 1;
  }

  let totalSum = 0;
  for (let value = 0; value < 256; value += 1) {
    totalSum += value * histogram[value];
  }

  let sumBackground = 0;
  let weightBackground = 0;
  let maxVariance = -1;
  let threshold = 127;

  for (let value = 0; value < 256; value += 1) {
    weightBackground += histogram[value];
    if (weightBackground === 0) {
      continue;
    }

    const weightForeground = input.length - weightBackground;
    if (weightForeground === 0) {
      break;
    }

    sumBackground += value * histogram[value];

    const meanBackground = sumBackground / weightBackground;
    const meanForeground = (totalSum - sumBackground) / weightForeground;
    const varianceBetween =
      weightBackground *
      weightForeground *
      (meanBackground - meanForeground) *
      (meanBackground - meanForeground);

    if (varianceBetween > maxVariance) {
      maxVariance = varianceBetween;
      threshold = value;
    }
  }

  const output = new Uint8Array(input.length);
  for (let index = 0; index < input.length; index += 1) {
    output[index] = input[index] <= threshold ? 1 : 0;
  }

  return output;
};

type Component = {
  pixels: number[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  area: number;
};

const connectedComponents = (
  input: BinaryData,
  width: number,
  height: number,
) => {
  const visited = new Uint8Array(input.length);
  const components: Component[] = [];

  for (let start = 0; start < input.length; start += 1) {
    if (input[start] !== 1 || visited[start] === 1) {
      continue;
    }

    const stack = [start];
    visited[start] = 1;

    const component: Component = {
      pixels: [],
      minX: width,
      minY: height,
      maxX: 0,
      maxY: 0,
      area: 0,
    };

    while (stack.length > 0) {
      const current = stack.pop() as number;
      const x = current % width;
      const y = Math.floor(current / width);

      component.pixels.push(current);
      component.area += 1;
      component.minX = Math.min(component.minX, x);
      component.minY = Math.min(component.minY, y);
      component.maxX = Math.max(component.maxX, x);
      component.maxY = Math.max(component.maxY, y);

      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          if (offsetX === 0 && offsetY === 0) {
            continue;
          }

          const nextX = x + offsetX;
          const nextY = y + offsetY;

          if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) {
            continue;
          }

          const nextIndex = nextY * width + nextX;

          if (input[nextIndex] !== 1 || visited[nextIndex] === 1) {
            continue;
          }

          visited[nextIndex] = 1;
          stack.push(nextIndex);
        }
      }
    }

    components.push(component);
  }

  return components;
};

const removeSmallComponents = (
  input: BinaryData,
  width: number,
  height: number,
) => {
  const output = new Uint8Array(input);
  const components = connectedComponents(input, width, height);
  let removedPixels = 0;
  const isLargeFrame = width >= 2500 || height >= 1500;
  const minComponentArea = isLargeFrame ? 5 : 8;
  const minComponentHeight = isLargeFrame ? 2 : 3;

  components.forEach(component => {
    const componentHeight = component.maxY - component.minY + 1;
    const shouldRemove =
      componentHeight < minComponentHeight || component.area < minComponentArea;

    if (!shouldRemove) {
      return;
    }

    component.pixels.forEach(index => {
      if (output[index] === 1) {
        output[index] = 0;
        removedPixels += 1;
      }
    });
  });

  return {
    output,
    removedPixels,
  };
};

const median = (values: number[]) => {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }

  return sorted[mid];
};

const keepDigitBand = (input: BinaryData, width: number, height: number) => {
  const isLargeFrame = width >= 2500 || height >= 1500;
  const components = connectedComponents(input, width, height).filter(
    component => {
      return (
        component.area >= (isLargeFrame ? 6 : 8) &&
        component.maxY - component.minY + 1 >= (isLargeFrame ? 4 : 5)
      );
    },
  );

  if (components.length === 0) {
    return {
      output: input,
      estimatedDigitHeight: 0,
    };
  }

  const heights = components.map(component => {
    return component.maxY - component.minY + 1;
  });

  const centers = components.map(component => {
    return (component.minY + component.maxY) / 2;
  });

  const dominantHeight = median(heights);
  const dominantCenterY = median(centers);
  const minHeight = Math.max(
    isLargeFrame ? 5 : 6,
    Math.floor(dominantHeight * (isLargeFrame ? 0.5 : 0.6)),
  );
  const maxHeight = Math.ceil(dominantHeight * (isLargeFrame ? 1.8 : 1.6));
  const toleranceY = Math.max(
    isLargeFrame ? 12 : 10,
    dominantHeight * (isLargeFrame ? 0.45 : 0.35),
  );

  const output = new Uint8Array(input.length);

  components.forEach(component => {
    const componentHeight = component.maxY - component.minY + 1;
    const componentCenterY = (component.minY + component.maxY) / 2;

    const heightMatch =
      componentHeight >= minHeight && componentHeight <= maxHeight;
    const rowMatch = Math.abs(componentCenterY - dominantCenterY) <= toleranceY;

    if (!heightMatch || !rowMatch) {
      return;
    }

    component.pixels.forEach(index => {
      output[index] = 1;
    });
  });

  const kept = output.reduce((count, pixel) => {
    return pixel === 1 ? count + 1 : count;
  }, 0);

  if (kept === 0) {
    return {
      output: input,
      estimatedDigitHeight: Math.round(dominantHeight),
    };
  }

  return {
    output,
    estimatedDigitHeight: Math.round(dominantHeight),
  };
};

const sharpenBinary = (input: BinaryData, width: number, height: number) => {
  const output = new Uint8Array(input.length);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const center = input[y * width + x] === 1 ? 0 : 255;
      const up = input[Math.max(0, y - 1) * width + x] === 1 ? 0 : 255;
      const down =
        input[Math.min(height - 1, y + 1) * width + x] === 1 ? 0 : 255;
      const left = input[y * width + Math.max(0, x - 1)] === 1 ? 0 : 255;
      const right =
        input[y * width + Math.min(width - 1, x + 1)] === 1 ? 0 : 255;

      const value = clamp(5 * center - up - down - left - right, 0, 255);
      output[y * width + x] = value < 128 ? 1 : 0;
    }
  }

  return output;
};

const grayToDataUrl = (gray: GrayData, width: number, height: number) => {
  const {canvas, ctx} = createCanvas(width, height);
  const imageData = ctx.createImageData(width, height);

  for (let index = 0; index < gray.length; index += 1) {
    const value = gray[index];
    const offset = index * 4;
    imageData.data[offset] = value;
    imageData.data[offset + 1] = value;
    imageData.data[offset + 2] = value;
    imageData.data[offset + 3] = 255;
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
};

const binaryToDataUrl = (binary: BinaryData, width: number, height: number) => {
  const {canvas, ctx} = createCanvas(width, height);
  const imageData = ctx.createImageData(width, height);

  for (let index = 0; index < binary.length; index += 1) {
    const value = binary[index] === 1 ? 0 : 255;
    const offset = index * 4;
    imageData.data[offset] = value;
    imageData.data[offset + 1] = value;
    imageData.data[offset + 2] = value;
    imageData.data[offset + 3] = 255;
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
};

const blackRatio = (binary: BinaryData) => {
  const blackPixels = binary.reduce((count, value) => {
    return value === 1 ? count + 1 : count;
  }, 0);

  return blackPixels / Math.max(1, binary.length);
};

export type CameraNikDebugMetrics = {
  capturedResolution: string;
  digitHeight: number;
  noiseRemoved: number;
  horizontalLinesRemoved: number;
};

export type CameraNikPipelineResult = {
  source: string;
  grayscale: string;
  clahe: string;
  lineRemoved: string;
  adaptive: string;
  cca: string;
  digitBand: string;
  finalBinary: string;
  sharpened: string;
  metrics: CameraNikDebugMetrics;
};

export const buildCameraNikPipeline = async (
  imageSrc: string,
  yieldMainThread: () => Promise<void>,
): Promise<CameraNikPipelineResult> => {
  const image = await loadImage(imageSrc);
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;

  const scaleFactor = Math.max(
    4,
    Math.ceil(1200 / Math.max(1, sourceWidth)),
    Math.ceil(300 / Math.max(1, sourceHeight)),
  );

  const width = Math.max(1, Math.round(sourceWidth * scaleFactor));
  const height = Math.max(1, Math.round(sourceHeight * scaleFactor));

  const {canvas, ctx} = createCanvas(width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, width, height);

  const sourceUrl = canvas.toDataURL('image/png');

  const rgba = ctx.getImageData(0, 0, width, height).data;
  const gray = toGray(rgba);
  await yieldMainThread();

  const claheStyled = localContrastEnhance(gray, width, height);
  await yieldMainThread();

  const lineRemovedResult = removeHorizontalLines(claheStyled, width, height);
  await yieldMainThread();

  const safeLineRemoved =
    lineRemovedResult.removedPixels > Math.floor(width * height * 0.12)
      ? {
          output: claheStyled,
          removedPixels: 0,
          removedLines: 0,
        }
      : lineRemovedResult;

  const denoisedGray = medianFilter3x3Gray(
    safeLineRemoved.output,
    width,
    height,
  );
  await yieldMainThread();

  let adaptiveBinary = sauvolaThreshold(denoisedGray, width, height);

  const initialAdaptiveRatio = blackRatio(adaptiveBinary);
  if (initialAdaptiveRatio < 0.006 || initialAdaptiveRatio > 0.45) {
    adaptiveBinary = otsuThreshold(denoisedGray);
  }

  if (blackRatio(adaptiveBinary) < 0.003) {
    adaptiveBinary = sauvolaThreshold(safeLineRemoved.output, width, height);
  }

  if (blackRatio(adaptiveBinary) < 0.003) {
    adaptiveBinary = sauvolaThreshold(gray, width, height);
  }

  if (blackRatio(adaptiveBinary) < 0.003) {
    adaptiveBinary = otsuThreshold(gray);
  }

  await yieldMainThread();

  let ccaResult = removeSmallComponents(adaptiveBinary, width, height);

  if (blackRatio(ccaResult.output) < 0.002) {
    ccaResult = {
      output: adaptiveBinary,
      removedPixels: 0,
    };
  }

  await yieldMainThread();

  let digitBandResult = keepDigitBand(ccaResult.output, width, height);

  if (blackRatio(digitBandResult.output) < 0.001) {
    digitBandResult = {
      output: ccaResult.output,
      estimatedDigitHeight: digitBandResult.estimatedDigitHeight,
    };
  }

  await yieldMainThread();

  let sharpenedBinary = sharpenBinary(digitBandResult.output, width, height);

  if (blackRatio(sharpenedBinary) < 0.001) {
    sharpenedBinary = new Uint8Array(digitBandResult.output);
  }

  return {
    source: sourceUrl,
    grayscale: grayToDataUrl(gray, width, height),
    clahe: grayToDataUrl(claheStyled, width, height),
    lineRemoved: grayToDataUrl(safeLineRemoved.output, width, height),
    adaptive: binaryToDataUrl(adaptiveBinary, width, height),
    cca: binaryToDataUrl(ccaResult.output, width, height),
    digitBand: binaryToDataUrl(digitBandResult.output, width, height),
    finalBinary: binaryToDataUrl(digitBandResult.output, width, height),
    sharpened: binaryToDataUrl(sharpenedBinary, width, height),
    metrics: {
      capturedResolution: `${sourceWidth}x${sourceHeight} -> ${width}x${height}`,
      digitHeight: digitBandResult.estimatedDigitHeight,
      noiseRemoved: safeLineRemoved.removedPixels + ccaResult.removedPixels,
      horizontalLinesRemoved: safeLineRemoved.removedLines,
    },
  };
};
