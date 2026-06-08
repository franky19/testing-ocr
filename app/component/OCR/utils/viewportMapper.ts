import {ImageDimensions, Rect} from './imageDimensions';

export interface ContainerDimensions {
  width: number;
  height: number;
}

interface ViewportMapperInput {
  viewport: Rect;
  container: ContainerDimensions;
  image: ImageDimensions;
}

const clamp = (value: number, min: number, max: number): number => {
  if (value < min) {
    return min;
  }

  if (value > max) {
    return max;
  }

  return value;
};

export const calculateViewportToImageCoordinates = ({
  viewport,
  container,
  image,
}: ViewportMapperInput): Rect => {
  const safeContainerWidth = Math.max(container.width, 1);
  const safeContainerHeight = Math.max(container.height, 1);
  const safeImageWidth = Math.max(image.width, 1);
  const safeImageHeight = Math.max(image.height, 1);

  // Match object-fit: cover behavior between camera preview and captured image.
  const scale = Math.max(
    safeContainerWidth / safeImageWidth,
    safeContainerHeight / safeImageHeight,
  );

  const displayedImageWidth = safeImageWidth * scale;
  const displayedImageHeight = safeImageHeight * scale;
  const offsetX = (safeContainerWidth - displayedImageWidth) / 2;
  const offsetY = (safeContainerHeight - displayedImageHeight) / 2;

  const imageX = (viewport.x - offsetX) / scale;
  const imageY = (viewport.y - offsetY) / scale;
  const imageWidth = viewport.width / scale;
  const imageHeight = viewport.height / scale;

  const clampedX = clamp(imageX, 0, safeImageWidth);
  const clampedY = clamp(imageY, 0, safeImageHeight);

  const maxWidth = Math.max(0, safeImageWidth - clampedX);
  const maxHeight = Math.max(0, safeImageHeight - clampedY);

  const clampedWidth = clamp(imageWidth, 1, maxWidth || 1);
  const clampedHeight = clamp(imageHeight, 1, maxHeight || 1);

  return {
    x: Math.round(clampedX),
    y: Math.round(clampedY),
    width: Math.round(clampedWidth),
    height: Math.round(clampedHeight),
  };
};
