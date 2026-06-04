import {BoundingBox, CropArea} from '../interface/ICamera';

export type ImageOcrHelpersOptions = {
  setProgress: (progress: number) => void;
  getCropAreaFromOverlay: (
    video: HTMLVideoElement,
    containerElement: HTMLElement,
    overlayBox: BoundingBox,
  ) => CropArea;
  visualizeCropArea: (
    video: HTMLVideoElement,
    containerElement: HTMLElement,
    overlayBox: BoundingBox,
    cropArea: CropArea,
  ) => HTMLCanvasElement | null;
};
