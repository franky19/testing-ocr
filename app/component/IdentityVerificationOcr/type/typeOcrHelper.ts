import {BoundingBox, CropArea} from '../interface/ICamera';

export type OcrHelpersOptions = {
  setProgress: (progress: number) => void;
  setOcrStatus: (status: string) => void;
  NIK_CHAR_MAP: Record<string, string>;
  NIK_OCR_WHITELIST: string;
  MDN_OCR_WHITELIST: string;
  MDN_CHAR_CORRECTION_MAP: Record<string, string>;
  NIK_DYNAMIC_SCALE_HEIGHT_THRESHOLD: number;
  MDN_PRIMARY_REGION: BoundingBox;
  NIK_DIGIT_CORRECTION_MAP: Record<string, string[]>;
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
