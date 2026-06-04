import {BoundingBox, CropArea} from './interface/ICamera';

const useDataOcr = () => {
  const videoConstraints = {
    width: {ideal: 3840},
    height: {ideal: 2160},
    aspectRatio: 16 / 9,
    facingMode: {
      ideal: 'environment',
    },
  };

  const WEBCAM_PREVIEW_WIDTH = 500;
  const WEBCAM_ASPECT_RATIO = '16 / 9';

  const NIK_CHAR_MAP: Record<string, string> = {
    O: '0',
    Q: '0',
    D: '0',
    U: '0',
    I: '1',
    L: '1',
    Z: '2',
    B: '8',
    S: '5',
    G: '6',
  };

  const NIK_OCR_WHITELIST =
    '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz:| ';

  const MDN_OCR_WHITELIST = '0123456789';

  const MDN_CHAR_CORRECTION_MAP: Record<string, string> = {
    O: '0',
    o: '0',
    Q: '0',
    D: '0',
    I: '1',
    l: '1',
    '|': '1',
    B: '8',
    S: '5',
  };

  const NIK_DYNAMIC_SCALE_HEIGHT_THRESHOLD = 120;

  const MDN_PRIMARY_REGION = {
    x: 0.05,
    y: 0.02,
    width: 0.55,
    height: 0.18,
  };

  const MDN_FALLBACK_REGION = {
    x: 0,
    y: 0,
    width: 0.7,
    height: 0.25,
  };

  const MDN_SCAN_PRIORITY_REGIONS: Array<{
    label: 'top' | 'middle' | 'full';
    area: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
  }> = [
    {
      label: 'top',
      area: {
        x: 0,
        y: 0,
        width: 1,
        height: 0.35,
      },
    },
    {
      label: 'middle',
      area: {
        x: 0,
        y: 0.35,
        width: 1,
        height: 0.25,
      },
    },
    {
      label: 'full',
      area: {
        x: 0,
        y: 0,
        width: 1,
        height: 1,
      },
    },
  ];

  const NIK_DIGIT_CORRECTION_MAP: Record<string, string[]> = {
    '7': ['1'],
    '1': ['7'],
    '0': ['8'],
    '8': ['0'],
  };

  const FIELD_AREAS = {
    nik: {
      x: 0.12,
      y: 0.14,
      width: 0.58,
      height: 0.1,
      threshold: 140,
    },

    nama: {
      x: 0.22,
      y: 0.24,
      width: 0.42,
      height: 0.11,
      threshold: 125,
    },

    ttl: {
      x: 0.25,
      y: 0.33,
      width: 0.45,
      height: 0.07,
      threshold: 120,
    },

    gender: {
      x: 0.22,
      y: 0.4,
      width: 0.48,
      height: 0.07,
      threshold: 160,
    },

    alamat: {
      x: 0.22,
      y: 0.47,
      width: 0.5,
      height: 0.25,
      threshold: 165,
    },

    agama: {
      x: 0.22,
      y: 0.65,
      width: 0.3,
      height: 0.06,
      threshold: 125,
    },

    status: {
      x: 0.32,
      y: 0.7,
      width: 0.36,
      height: 0.06,
      threshold: 160,
    },
  };

  const CAMERA_FIELD_AREAS = {
    nik: {
      desktop: {
        x: 0.12,
        y: 0.14,
        width: 0.58,
        height: 0.1,
      },
      mobile: {
        x: 0.12,
        y: 0.14,
        width: 0.7,
        height: 0.15,
      },
    },
    mdn: {
      desktop: {
        x: 0.1,
        y: 0.08,
        width: 0.72,
        height: 0.18,
      },
      mobile: {
        x: 0.08,
        y: 0.06,
        width: 0.84,
        height: 0.22,
      },
    },
  };

  const getNikOverlayArea = (viewportWidth: number): BoundingBox => {
    const isMobile = viewportWidth > 0 && viewportWidth < 768;

    return isMobile
      ? CAMERA_FIELD_AREAS.nik.mobile
      : CAMERA_FIELD_AREAS.nik.desktop;
  };

  const getMdnOverlayArea = (viewportWidth: number): BoundingBox => {
    const isMobile = viewportWidth > 0 && viewportWidth < 768;

    return isMobile
      ? CAMERA_FIELD_AREAS.mdn.mobile
      : CAMERA_FIELD_AREAS.mdn.desktop;
  };

  /**
   * HELPER: Calculate actual crop area considering object-fit: cover
   *
   * Transform coordinates from:
   * Overlay Coordinate (Preview Layer 0-1)
   * ↓
   * Displayed Video Coordinate
   * ↓
   * Actual Video Coordinate (with object-fit: cover offset)
   * ↓
   * Captured Canvas Coordinate
   */

  const getCropAreaFromOverlay = (
    video: HTMLVideoElement,
    containerElement: HTMLElement,
    overlayBox: BoundingBox,
  ): CropArea => {
    const videoWidth = video?.videoWidth ?? 0;

    const videoHeight = video?.videoHeight ?? 0;

    if (!video || !containerElement || videoWidth === 0 || videoHeight === 0) {
      return {
        cropX: 0,
        cropY: 0,
        cropWidth: 1,
        cropHeight: 1,
      };
    }

    const containerRect = containerElement.getBoundingClientRect();

    const containerWidth = containerRect.width;

    const containerHeight = containerRect.height;

    if (containerWidth === 0 || containerHeight === 0) {
      return {
        cropX: 0,
        cropY: 0,
        cropWidth: 1,
        cropHeight: 1,
      };
    }

    const scale = Math.max(
      containerWidth / videoWidth,
      containerHeight / videoHeight,
    );

    const renderedWidth = videoWidth * scale;

    const renderedHeight = videoHeight * scale;

    const offsetX = (renderedWidth - containerWidth) / 2;

    const offsetY = (renderedHeight - containerHeight) / 2;

    const overlayContainerX = overlayBox.x * containerWidth;

    const overlayContainerY = overlayBox.y * containerHeight;

    const overlayContainerWidth = overlayBox.width * containerWidth;

    const overlayContainerHeight = overlayBox.height * containerHeight;

    const overlayRenderedX = overlayContainerX + offsetX;

    const overlayRenderedY = overlayContainerY + offsetY;

    const cropX = Math.round((overlayRenderedX / renderedWidth) * videoWidth);

    const cropY = Math.round((overlayRenderedY / renderedHeight) * videoHeight);

    const cropWidth = Math.round(
      (overlayContainerWidth / renderedWidth) * videoWidth,
    );

    const cropHeight = Math.round(
      (overlayContainerHeight / renderedHeight) * videoHeight,
    );

    const clampedCropX = Math.max(0, Math.min(cropX, videoWidth - 1));

    const clampedCropY = Math.max(0, Math.min(cropY, videoHeight - 1));

    const clampedCropWidth = Math.max(
      1,
      Math.min(cropWidth, videoWidth - clampedCropX),
    );

    const clampedCropHeight = Math.max(
      1,
      Math.min(cropHeight, videoHeight - clampedCropY),
    );

    // eslint-disable-next-line no-console
    console.table({
      videoWidth,
      videoHeight,
      containerWidth,
      containerHeight,
      scale,
      offsetX,
      offsetY,
      cropX: clampedCropX,
      cropY: clampedCropY,
      cropWidth: clampedCropWidth,
      cropHeight: clampedCropHeight,
    });

    return {
      cropX: clampedCropX,
      cropY: clampedCropY,
      cropWidth: clampedCropWidth,
      cropHeight: clampedCropHeight,
    };
  };

  /**
   * HELPER: Validate crop area by comparing captured image with overlay
   *
   * Optional: Use this to verify that captured area matches overlay visually
   * Returns a canvas with comparison visualization
   */

  const visualizeCropArea = (
    video: HTMLVideoElement,
    containerElement: HTMLElement,
    overlayBox: BoundingBox,
    cropArea: CropArea,
  ): HTMLCanvasElement | null => {
    const canvas = document.createElement('canvas');

    const videoWidth = video.videoWidth;

    const videoHeight = video.videoHeight;

    canvas.width = videoWidth;

    canvas.height = videoHeight;

    const ctx = canvas.getContext('2d');

    if (!ctx) return null;

    /**
     * Draw full video frame
     */

    ctx.drawImage(video, 0, 0);

    /**
     * Draw crop boundary with red outline
     */

    ctx.strokeStyle = 'red';

    ctx.lineWidth = 5;

    ctx.strokeRect(
      cropArea.cropX,
      cropArea.cropY,
      cropArea.cropWidth,
      cropArea.cropHeight,
    );

    /**
     * Draw text info
     */

    ctx.fillStyle = 'white';

    ctx.font = 'bold 24px Arial';

    ctx.fillText(`Crop: ${cropArea.cropWidth}x${cropArea.cropHeight}`, 20, 40);

    ctx.fillText(`Video: ${videoWidth}x${videoHeight}`, 20, 80);

    const containerRect = containerElement.getBoundingClientRect();

    ctx.fillText(
      `Container: ${Math.round(containerRect.width)}x${Math.round(
        containerRect.height,
      )}`,
      20,
      120,
    );

    ctx.fillText(
      `Overlay: x=${overlayBox.x.toFixed(3)} y=${overlayBox.y.toFixed(
        3,
      )} w=${overlayBox.width.toFixed(3)} h=${overlayBox.height.toFixed(3)}`,
      20,
      160,
    );

    return canvas;
  };

  return {
    videoConstraints,
    WEBCAM_PREVIEW_WIDTH,
    WEBCAM_ASPECT_RATIO,
    NIK_CHAR_MAP,
    NIK_OCR_WHITELIST,
    MDN_OCR_WHITELIST,
    MDN_CHAR_CORRECTION_MAP,
    NIK_DYNAMIC_SCALE_HEIGHT_THRESHOLD,
    MDN_PRIMARY_REGION,
    MDN_FALLBACK_REGION,
    MDN_SCAN_PRIORITY_REGIONS,
    NIK_DIGIT_CORRECTION_MAP,
    FIELD_AREAS,
    CAMERA_FIELD_AREAS,
    getNikOverlayArea,
    getMdnOverlayArea,
    getCropAreaFromOverlay,
    visualizeCropArea,
  };
};
export default useDataOcr;
