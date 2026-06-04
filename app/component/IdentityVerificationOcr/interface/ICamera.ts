/**
 * COORDINATE TRANSFORMATION TYPES
 */

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CropArea {
  cropX: number;
  cropY: number;
  cropWidth: number;
  cropHeight: number;
}

export interface CameraDebugData {
  fullFrameImage: string;
  overlayDebugImage: string;
  cropArea: CropArea;
  overlayBox: BoundingBox;
  videoWidth: number;
  videoHeight: number;
  containerWidth: number;
  containerHeight: number;
}

export interface CapturedOverlayFrame {
  imageSrc: string;
  cameraDebugData: CameraDebugData;
}
