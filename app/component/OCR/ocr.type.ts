export type ViewportMapping = {
  videoWidth: number;
  videoHeight: number;
  imageWidth: number;
  imageHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  overlayLeft: number;
  overlayTop: number;
  overlayWidth: number;
  overlayHeight: number;
  renderedWidth: number;
  renderedHeight: number;
  scale: number;
  offsetX: number;
  offsetY: number;
  normalizedX: number;
  normalizedY: number;
  normalizedWidth: number;
  normalizedHeight: number;
  sourceX: number;
  sourceY: number;
  sourceWidth: number;
  sourceHeight: number;
};

export type CropRect = {
  sourceX: number;
  sourceY: number;
  sourceWidth: number;
  sourceHeight: number;
};

export type DebugOverlayData = {
  mapping: ViewportMapping;
};
