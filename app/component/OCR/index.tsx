'use client';

import React, {useState, useRef, useEffect} from 'react';
import {Camera} from 'react-camera-pro';
import Tesseract from 'tesseract.js';
import styles from './OcrScanner.module.css';

type OverlayArea = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type PixelRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type VisibleVideoRect = {
  videoWidth: number;
  videoHeight: number;
  containerWidth: number;
  containerHeight: number;
  renderedWidth: number;
  renderedHeight: number;
  scale: number;
  offsetX: number;
  offsetY: number;
  mirrored: boolean;
};

type ObjectPosition = {
  x: number;
  y: number;
};

type OverlayMapping = {
  normalizedRect: OverlayArea;
  videoRect: PixelRect;
  captureRect: PixelRect;
  visibleVideoRect: VisibleVideoRect;
};

type CapturePreview = {
  original: string;
  overlayDebug: string;
  cropped: string;
  processed: string;
};

const NIK_OVERLAY_PRESETS = {
  mobile: {
    x: 0.08,
    y: 0.26,
    width: 0.84,
    height: 0.16,
  },
  tablet: {
    x: 0.1,
    y: 0.28,
    width: 0.8,
    height: 0.16,
  },
  desktop: {
    x: 0.11,
    y: 0.3,
    width: 0.78,
    height: 0.15,
  },
};

export default function OcrScanner() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cameraRef = useRef<any>(null);
  const cameraWrapperRef = useRef<HTMLDivElement | null>(null);

  const [capturePreview, setCapturePreview] = useState<CapturePreview | null>(
    null,
  );
  const [extractedText, setExtractedText] = useState('');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [overlayArea, setOverlayArea] = useState<OverlayArea>(
    NIK_OVERLAY_PRESETS.mobile,
  );
  const [isCalibrationOpen, setIsCalibrationOpen] = useState(false);
  const [hasCustomOverlay, setHasCustomOverlay] = useState(false);
  const [isDebugMode, setIsDebugMode] = useState(true);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>(
    'environment',
  );
  const [debugInfo, setDebugInfo] = useState<Record<string, number> | null>(
    null,
  );

  const getPresetByScreenWidth = (screenWidth: number): OverlayArea => {
    if (screenWidth >= 1024) {
      return NIK_OVERLAY_PRESETS.desktop;
    }

    if (screenWidth >= 768) {
      return NIK_OVERLAY_PRESETS.tablet;
    }

    return NIK_OVERLAY_PRESETS.mobile;
  };

  const clamp = (value: number, min: number, max: number) =>
    Math.min(Math.max(value, min), max);

  const updateOverlayAreaValue = (key: keyof OverlayArea, value: number) => {
    setHasCustomOverlay(true);

    setOverlayArea(previous => {
      const next = {
        ...previous,
        [key]: value,
      };

      if (key === 'width') {
        next.width = clamp(value, 0.4, 0.95);
      }

      if (key === 'height') {
        next.height = clamp(value, 0.08, 0.35);
      }

      next.x = clamp(next.x, 0, 1 - next.width);
      next.y = clamp(next.y, 0, 1 - next.height);

      return next;
    });
  };

  const resetOverlayToDevicePreset = () => {
    setHasCustomOverlay(false);
    setOverlayArea(getPresetByScreenWidth(window.innerWidth));
  };

  useEffect(() => {
    const updateOverlayArea = () => {
      if (hasCustomOverlay) {
        return;
      }

      setOverlayArea(getPresetByScreenWidth(window.innerWidth));
    };

    updateOverlayArea();
    window.addEventListener('resize', updateOverlayArea);

    return () => window.removeEventListener('resize', updateOverlayArea);
  }, [hasCustomOverlay]);

  const getVideoElement = () =>
    cameraWrapperRef.current?.querySelector('video') as HTMLVideoElement | null;

  const isMirroredVideo = (videoElement: HTMLVideoElement) => {
    const transform = window.getComputedStyle(videoElement).transform;

    if (!transform || transform === 'none') {
      return facingMode === 'user';
    }

    try {
      const matrix = new DOMMatrixReadOnly(transform);
      return matrix.a < 0 || facingMode === 'user';
    } catch {
      return facingMode === 'user';
    }
  };

  const loadImage = (imageSrc: string) =>
    new Promise<HTMLImageElement>((resolve, reject) => {
      const img = document.createElement('img');

      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = imageSrc;
    });

  const parseObjectPosition = (value: string): ObjectPosition => {
    const parts = value.trim().split(/\s+/);
    const [xRaw, yRaw = xRaw] = parts;

    const parsePart = (part: string) => {
      if (part.endsWith('%')) {
        return clamp(Number(part.replace('%', '')) / 100, 0, 1);
      }

      if (part === 'left' || part === 'top') {
        return 0;
      }

      if (part === 'right' || part === 'bottom') {
        return 1;
      }

      return 0.5;
    };

    return {
      x: parsePart(xRaw),
      y: parsePart(yRaw),
    };
  };

  const captureFrameFromVideo = (videoElement: HTMLVideoElement) => {
    const canvas = document.createElement('canvas');
    canvas.width = videoElement.videoWidth;
    canvas.height = videoElement.videoHeight;

    const context = canvas.getContext('2d');

    if (!context) {
      throw new Error('Failed to get canvas context');
    }

    context.drawImage(videoElement, 0, 0, canvas.width, canvas.height);

    return canvas.toDataURL('image/jpeg', 0.95);
  };

  const getVisibleVideoRect = (): VisibleVideoRect | null => {
    const container = cameraWrapperRef.current;

    if (!container) return null;

    const videoElement = getVideoElement();

    if (!videoElement) return null;

    const videoWidth = videoElement.videoWidth;
    const videoHeight = videoElement.videoHeight;

    if (!videoWidth || !videoHeight) return null;

    const containerRect = container.getBoundingClientRect();
    const containerWidth = containerRect.width;
    const containerHeight = containerRect.height;

    if (!containerWidth || !containerHeight) return null;

    const scale = Math.max(containerWidth / videoWidth, containerHeight / videoHeight);
    const renderedWidth = videoWidth * scale;
    const renderedHeight = videoHeight * scale;
    const computedStyle = window.getComputedStyle(videoElement);
    const objectPosition = parseObjectPosition(
      computedStyle.objectPosition || '50% 50%',
    );
    const offsetX = Math.max(0, renderedWidth - containerWidth) * objectPosition.x;
    const offsetY = Math.max(0, renderedHeight - containerHeight) * objectPosition.y;

    return {
      videoWidth,
      videoHeight,
      containerWidth,
      containerHeight,
      renderedWidth,
      renderedHeight,
      scale,
      offsetX,
      offsetY,
      mirrored: isMirroredVideo(videoElement),
    };
  };

  const getOverlayRectInVideoSpace = (
    visibleVideoRect: VisibleVideoRect,
  ): OverlayMapping => {
    const overlayContainerX = overlayArea.x * visibleVideoRect.containerWidth;
    const overlayContainerY = overlayArea.y * visibleVideoRect.containerHeight;
    const overlayContainerWidth = overlayArea.width * visibleVideoRect.containerWidth;
    const overlayContainerHeight = overlayArea.height * visibleVideoRect.containerHeight;

    const normalizedX =
      (overlayContainerX + visibleVideoRect.offsetX) /
      visibleVideoRect.renderedWidth;
    const normalizedY =
      (overlayContainerY + visibleVideoRect.offsetY) /
      visibleVideoRect.renderedHeight;
    const normalizedWidth =
      overlayContainerWidth / visibleVideoRect.renderedWidth;
    const normalizedHeight =
      overlayContainerHeight / visibleVideoRect.renderedHeight;

    const x = clamp(normalizedX, 0, 1);
    const y = clamp(normalizedY, 0, 1);
    const width = clamp(normalizedWidth, 0, 1 - x);
    const height = clamp(normalizedHeight, 0, 1 - y);

    const mappedX = visibleVideoRect.mirrored ? 1 - x - width : x;
    const normalizedRect = {
      x: clamp(mappedX, 0, 1 - width),
      y,
      width,
      height,
    };

    const videoRect = {
      x: Math.round(normalizedRect.x * visibleVideoRect.videoWidth),
      y: Math.round(normalizedRect.y * visibleVideoRect.videoHeight),
      width: Math.round(normalizedRect.width * visibleVideoRect.videoWidth),
      height: Math.round(normalizedRect.height * visibleVideoRect.videoHeight),
    };

    return {
      normalizedRect,
      videoRect,
      captureRect: {x: 0, y: 0, width: 0, height: 0},
      visibleVideoRect,
    };
  };

  const cropCapturedImage = async (
    imageSrc: string,
    mapping: OverlayMapping,
  ) => {
    const img = await loadImage(imageSrc);
    const widthRatio = img.width / mapping.visibleVideoRect.videoWidth;
    const heightRatio = img.height / mapping.visibleVideoRect.videoHeight;
    const captureRect = {
      x: clamp(
        Math.round(mapping.videoRect.x * widthRatio),
        0,
        Math.max(img.width - 1, 0),
      ),
      y: clamp(
        Math.round(mapping.videoRect.y * heightRatio),
        0,
        Math.max(img.height - 1, 0),
      ),
      width: clamp(
        Math.round(mapping.videoRect.width * widthRatio),
        1,
        img.width,
      ),
      height: clamp(
        Math.round(mapping.videoRect.height * heightRatio),
        1,
        img.height,
      ),
    };

    captureRect.width = Math.min(captureRect.width, img.width - captureRect.x);
    captureRect.height = Math.min(
      captureRect.height,
      img.height - captureRect.y,
    );

    const canvas = document.createElement('canvas');
    canvas.width = captureRect.width;
    canvas.height = captureRect.height;

    const context = canvas.getContext('2d');

    if (!context) {
      throw new Error('Failed to get canvas context');
    }

    context.drawImage(
      img,
      captureRect.x,
      captureRect.y,
      captureRect.width,
      captureRect.height,
      0,
      0,
      captureRect.width,
      captureRect.height,
    );

    return {
      image: canvas.toDataURL('image/jpeg', 0.95),
      captureRect,
      sourceWidth: img.width,
      sourceHeight: img.height,
    };
  };

  const drawOverlayDebug = async (
    imageSrc: string,
    captureRect: PixelRect,
    debugMode: boolean,
  ) => {
    const img = await loadImage(imageSrc);

    if (!debugMode) {
      return imageSrc;
    }

    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;

    const context = canvas.getContext('2d');

    if (!context) {
      throw new Error('Failed to get canvas context');
    }

    context.drawImage(img, 0, 0, img.width, img.height);
    context.strokeStyle = '#ef4444';
    context.lineWidth = Math.max(4, Math.round(Math.min(img.width, img.height) * 0.005));
    context.strokeRect(
      captureRect.x,
      captureRect.y,
      captureRect.width,
      captureRect.height,
    );

    return canvas.toDataURL('image/jpeg', 0.95);
  };

  const preprocessImageForOcr = async (imageSrc: string) => {
    const img = await loadImage(imageSrc);
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;

    const context = canvas.getContext('2d');

    if (!context) {
      throw new Error('Failed to get canvas context');
    }

    context.drawImage(img, 0, 0, img.width, img.height);

    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    for (let index = 0; index < data.length; index += 4) {
      const grayscale =
        data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114;
      const brightnessAdjusted = grayscale + 255 * 0.2;
      const contrastAdjusted = (brightnessAdjusted - 128) * 1.4 + 128;
      const nextValue = clamp(Math.round(contrastAdjusted), 0, 255);

      data[index] = nextValue;
      data[index + 1] = nextValue;
      data[index + 2] = nextValue;
    }

    const sharpened = new Uint8ClampedArray(data);
    const kernel = [0, -1, 0, -1, 5, -1, 0, -1, 0];
    const width = canvas.width;
    const height = canvas.height;

    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        let accumulated = 0;
        let kernelIndex = 0;

        for (let ky = -1; ky <= 1; ky += 1) {
          for (let kx = -1; kx <= 1; kx += 1) {
            const sourceIndex = ((y + ky) * width + (x + kx)) * 4;
            accumulated += data[sourceIndex] * kernel[kernelIndex];
            kernelIndex += 1;
          }
        }

        const nextValue = clamp(Math.round(accumulated), 0, 255);
        const targetIndex = (y * width + x) * 4;
        sharpened[targetIndex] = nextValue;
        sharpened[targetIndex + 1] = nextValue;
        sharpened[targetIndex + 2] = nextValue;
      }
    }

    imageData.data.set(sharpened);
    context.putImageData(imageData, 0, 0);

    return canvas.toDataURL('image/jpeg', 0.95);
  };

  const handleOcr = async (imageSrc: string) => {
    setLoading(true);
    setExtractedText('');

    try {
      const result = await Tesseract.recognize(imageSrc, 'eng', {
        logger: m => {
          if (m.status === 'recognizing text') {
            setProgress(Math.round(m.progress * 100));
          }
        },
      });

      setExtractedText(result.data.text);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown OCR error';
      setExtractedText(`Error extracting text: ${errorMessage}`);
    } finally {
      setLoading(false);
      setProgress(0);
    }
  };

  const runOcrPipeline = async (
    originalPhoto: string,
    mapping: OverlayMapping | null,
  ) => {
    const croppedResult = mapping
      ? await cropCapturedImage(originalPhoto, mapping)
      : await cropCapturedImage(originalPhoto, {
          normalizedRect: {x: 0, y: 0, width: 1, height: 1},
          videoRect: {
            x: 0,
            y: 0,
            width: 1,
            height: 1,
          },
          captureRect: {x: 0, y: 0, width: 0, height: 0},
          visibleVideoRect: {
            videoWidth: 1,
            videoHeight: 1,
            containerWidth: 1,
            containerHeight: 1,
            renderedWidth: 1,
            renderedHeight: 1,
            scale: 1,
            offsetX: 0,
            offsetY: 0,
            mirrored: false,
          },
        });

    const overlayDebug = await drawOverlayDebug(
      originalPhoto,
      croppedResult.captureRect,
      Boolean(mapping) && isDebugMode,
    );
    const processedImage = await preprocessImageForOcr(croppedResult.image);

    setCapturePreview({
      original: originalPhoto,
      overlayDebug,
      cropped: croppedResult.image,
      processed: processedImage,
    });

    if (mapping) {
      setDebugInfo({
        videoWidth: mapping.visibleVideoRect.videoWidth,
        videoHeight: mapping.visibleVideoRect.videoHeight,
        containerWidth: Math.round(mapping.visibleVideoRect.containerWidth),
        containerHeight: Math.round(mapping.visibleVideoRect.containerHeight),
        offsetX: Math.round(mapping.visibleVideoRect.offsetX),
        offsetY: Math.round(mapping.visibleVideoRect.offsetY),
        cropX: croppedResult.captureRect.x,
        cropY: croppedResult.captureRect.y,
        cropWidth: croppedResult.captureRect.width,
        cropHeight: croppedResult.captureRect.height,
        captureWidth: croppedResult.sourceWidth,
        captureHeight: croppedResult.sourceHeight,
      });
    } else {
      setDebugInfo(null);
    }

    await handleOcr(processedImage);
  };

  const captureCameraImage = async () => {
    if (!cameraRef.current) {
      return;
    }

    const visibleVideoRect = getVisibleVideoRect();
    const videoElement = getVideoElement();

    if (!visibleVideoRect || !videoElement) {
      setExtractedText('Error cropping captured image: Video metadata unavailable');
      return;
    }

    try {
      const photo = captureFrameFromVideo(videoElement);
      const mapping = getOverlayRectInVideoSpace(visibleVideoRect);
      await runOcrPipeline(photo, mapping);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown crop error';
      setExtractedText(`Error cropping captured image: ${errorMessage}`);
      setDebugInfo(null);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];

    if (!file) return;

    const reader = new FileReader();

    reader.onloadend = async () => {
      const base64String = reader.result as string;

      try {
        await runOcrPipeline(base64String, null);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown OCR error';
        setExtractedText(`Error extracting text: ${errorMessage}`);
        setDebugInfo(null);
      }
    };

    reader.readAsDataURL(file);
  };

  const toggleFacingMode = () => {
    setFacingMode(previous =>
      previous === 'environment' ? 'user' : 'environment',
    );
  };

  return (
    <div className={styles.container}>
      <h1 className={styles.title}>Next.js Camera & Image OCR</h1>

      <div className={styles.cameraWrapper} ref={cameraWrapperRef}>
        <Camera
          facingMode={facingMode}
          ref={cameraRef}
          aspectRatio={16 / 9}
          errorMessages={{
            noCameraAccessible: 'No camera device found',
          }}
        />

        <div className={styles.overlayMask}>
          <div
            className={styles.scanArea}
            style={{
              left: `${overlayArea.x * 100}%`,
              top: `${overlayArea.y * 100}%`,
              width: `${overlayArea.width * 100}%`,
              height: `${overlayArea.height * 100}%`,
            }}>
            <span className={styles.scanLabel}>Posisikan NIK di area ini</span>
          </div>
        </div>
      </div>

      <div className={styles.controls}>
        <button
          onClick={captureCameraImage}
          className={styles.button}
          disabled={loading}>
          Capture & Scan
        </button>

        <label htmlFor="ocr-image-upload" className={styles.uploadButton}>
          Upload Image
        </label>

        <button
          onClick={() => setIsCalibrationOpen(previous => !previous)}
          className={styles.calibrationButton}
          type="button">
          {isCalibrationOpen ? 'Tutup Kalibrasi' : 'Kalibrasi Overlay'}
        </button>

        <button
          onClick={toggleFacingMode}
          className={styles.secondaryButton}
          type="button"
          disabled={loading}>
          {facingMode === 'environment' ? 'Pakai Kamera Depan' : 'Pakai Kamera Belakang'}
        </button>

        <button
          onClick={() => setIsDebugMode(previous => !previous)}
          className={styles.secondaryButton}
          type="button">
          {isDebugMode ? 'Debug Overlay Aktif' : 'Aktifkan Debug Overlay'}
        </button>

        <input
          id="ocr-image-upload"
          type="file"
          accept="image/*"
          onChange={handleFileUpload}
          className={styles.hiddenInput}
          disabled={loading}
        />
      </div>

      {isCalibrationOpen && (
        <div className={styles.calibrationPanel}>
          <p className={styles.calibrationTitle}>Kalibrasi Area NIK</p>

          <label className={styles.sliderField}>
            X: {(overlayArea.x * 100).toFixed(1)}%
            <input
              type="range"
              min="0"
              max={(1 - overlayArea.width).toFixed(3)}
              step="0.005"
              value={overlayArea.x}
              onChange={event =>
                updateOverlayAreaValue('x', Number(event.target.value))
              }
            />
          </label>

          <label className={styles.sliderField}>
            Y: {(overlayArea.y * 100).toFixed(1)}%
            <input
              type="range"
              min="0"
              max={(1 - overlayArea.height).toFixed(3)}
              step="0.005"
              value={overlayArea.y}
              onChange={event =>
                updateOverlayAreaValue('y', Number(event.target.value))
              }
            />
          </label>

          <label className={styles.sliderField}>
            Width: {(overlayArea.width * 100).toFixed(1)}%
            <input
              type="range"
              min="0.4"
              max="0.95"
              step="0.005"
              value={overlayArea.width}
              onChange={event =>
                updateOverlayAreaValue('width', Number(event.target.value))
              }
            />
          </label>

          <label className={styles.sliderField}>
            Height: {(overlayArea.height * 100).toFixed(1)}%
            <input
              type="range"
              min="0.08"
              max="0.35"
              step="0.005"
              value={overlayArea.height}
              onChange={event =>
                updateOverlayAreaValue('height', Number(event.target.value))
              }
            />
          </label>

          <button
            className={styles.resetPresetButton}
            onClick={resetOverlayToDevicePreset}
            type="button">
            Gunakan Preset Device
          </button>
        </div>
      )}

      {loading && (
        <div className={styles.progressContainer}>
          <div className={styles.progressBar} style={{width: `${progress}%`}}>
            {progress}%
          </div>
        </div>
      )}

      {capturePreview && (
        <div className={styles.previewGrid}>
          <div className={styles.imagePreview}>
            <p className={styles.previewTitle}>Original Camera Capture</p>
            <img
              src={capturePreview.original}
              alt="Original capture"
              className={styles.previewImage}
            />
          </div>

          <div className={styles.imagePreview}>
            <p className={styles.previewTitle}>Overlay Mapping Preview</p>
            <img
              src={capturePreview.overlayDebug}
              alt="Overlay mapping preview"
              className={styles.previewImage}
            />
          </div>

          <div className={styles.imagePreview}>
            <p className={styles.previewTitle}>Cropped OCR Area</p>
            <img
              src={capturePreview.cropped}
              alt="Cropped OCR area"
              className={styles.previewImage}
            />
          </div>

          <div className={styles.imagePreview}>
            <p className={styles.previewTitle}>OCR Preprocessed Area</p>
            <img
              src={capturePreview.processed}
              alt="OCR preprocessed area"
              className={styles.previewImage}
            />
          </div>
        </div>
      )}

      {isDebugMode && debugInfo && (
        <div className={styles.debugPanel}>
          <p className={styles.resultTitle}>Overlay Debug Metadata</p>
          <div className={styles.debugGrid}>
            {Object.entries(debugInfo).map(([key, value]) => (
              <div className={styles.debugItem} key={key}>
                <span className={styles.debugLabel}>{key}</span>
                <span className={styles.debugValue}>{value}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {extractedText && (
        <div className={styles.resultContainer}>
          <p className={styles.resultTitle}>OCR Text Result</p>

          <div className={styles.resultText}>{extractedText}</div>
        </div>
      )}
    </div>
  );
}
