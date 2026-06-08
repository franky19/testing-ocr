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

type CapturePreview = {
  original: string;
  viewport: string;
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

    const videoRect = videoElement.getBoundingClientRect();
    const renderedWidth = videoRect.width;
    const renderedHeight = videoRect.height;

    if (!renderedWidth || !renderedHeight) {
      return null;
    }

    const scale = renderedWidth / videoWidth;
    const offsetX = containerRect.left - videoRect.left;
    const offsetY = containerRect.top - videoRect.top;

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

  const cropImageByRect = async (imageSrc: string, rect: PixelRect) => {
    const img = await loadImage(imageSrc);
    const x = Math.round(clamp(rect.x, 0, Math.max(img.naturalWidth - 1, 0)));
    const y = Math.round(clamp(rect.y, 0, Math.max(img.naturalHeight - 1, 0)));
    const width = Math.round(
      clamp(rect.width, 1, Math.max(img.naturalWidth - x, 1)),
    );
    const height = Math.round(
      clamp(rect.height, 1, Math.max(img.naturalHeight - y, 1)),
    );

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d');

    if (!context) {
      throw new Error('Failed to get canvas context');
    }

    context.drawImage(img, x, y, width, height, 0, 0, width, height);

    return {
      image: canvas.toDataURL('image/jpeg', 0.95),
      rect: {x, y, width, height},
      sourceWidth: img.naturalWidth,
      sourceHeight: img.naturalHeight,
    };
  };

  const getOverlayRectInImageSpace = (
    imageWidth: number,
    imageHeight: number,
    mirrored: boolean,
  ): PixelRect => {
    const width = Math.round(clamp(overlayArea.width * imageWidth, 1, imageWidth));
    const height = Math.round(clamp(overlayArea.height * imageHeight, 1, imageHeight));
    const xBase = Math.round(
      clamp(overlayArea.x * imageWidth, 0, Math.max(imageWidth - width, 0)),
    );
    const y = Math.round(
      clamp(overlayArea.y * imageHeight, 0, Math.max(imageHeight - height, 0)),
    );
    const x = mirrored ? Math.max(0, imageWidth - xBase - width) : xBase;

    return {x, y, width, height};
  };

  async function captureVisibleViewport(): Promise<string> {
    const container = cameraWrapperRef.current;
    const videoElement = getVideoElement();

    if (!cameraRef.current || !container || !videoElement) {
      throw new Error('Camera is not ready');
    }

    const visibleVideoRect = getVisibleVideoRect();

    if (!visibleVideoRect) {
      throw new Error('Video metadata unavailable');
    }

    const photo = cameraRef.current.takePhoto() as string;
    const image = await loadImage(photo);

    const scaleX = image.naturalWidth / visibleVideoRect.videoWidth;
    const scaleY = image.naturalHeight / visibleVideoRect.videoHeight;

    const viewportCropRect = {
      x: Math.round(
        clamp(
          (visibleVideoRect.offsetX / visibleVideoRect.renderedWidth) *
            image.naturalWidth,
          0,
          Math.max(image.naturalWidth - 1, 0),
        ),
      ),
      y: Math.round(
        clamp(
          (visibleVideoRect.offsetY / visibleVideoRect.renderedHeight) *
            image.naturalHeight,
          0,
          Math.max(image.naturalHeight - 1, 0),
        ),
      ),
      width: Math.round(
        clamp(
          (visibleVideoRect.containerWidth / visibleVideoRect.renderedWidth) *
            image.naturalWidth,
          1,
          image.naturalWidth,
        ),
      ),
      height: Math.round(
        clamp(
          (visibleVideoRect.containerHeight / visibleVideoRect.renderedHeight) *
            image.naturalHeight,
          1,
          image.naturalHeight,
        ),
      ),
    };

    const croppedViewport = await cropImageByRect(photo, viewportCropRect);
    const viewportImage = croppedViewport.image;
    const overlayRect = getOverlayRectInImageSpace(
      croppedViewport.rect.width,
      croppedViewport.rect.height,
      visibleVideoRect.mirrored,
    );
    const ocrCrop = await cropImageByRect(viewportImage, overlayRect);
    const overlayDebug = await drawOverlayDebug(
      viewportImage,
      overlayRect,
      isDebugMode,
    );
    const processedImage = await preprocessImageForOcr(ocrCrop.image);

    setCapturePreview({
      original: photo,
      viewport: viewportImage,
      overlayDebug,
      cropped: ocrCrop.image,
      processed: processedImage,
    });

    setDebugInfo({
      videoWidth: visibleVideoRect.videoWidth,
      videoHeight: visibleVideoRect.videoHeight,
      containerWidth: Math.round(visibleVideoRect.containerWidth),
      containerHeight: Math.round(visibleVideoRect.containerHeight),
      renderedWidth: Math.round(visibleVideoRect.renderedWidth),
      renderedHeight: Math.round(visibleVideoRect.renderedHeight),
      scaleX: Number(scaleX.toFixed(4)),
      scaleY: Number(scaleY.toFixed(4)),
      offsetX: Math.round(visibleVideoRect.offsetX),
      offsetY: Math.round(visibleVideoRect.offsetY),
      viewportCropX: croppedViewport.rect.x,
      viewportCropY: croppedViewport.rect.y,
      viewportCropWidth: croppedViewport.rect.width,
      viewportCropHeight: croppedViewport.rect.height,
      cropX: ocrCrop.rect.x,
      cropY: ocrCrop.rect.y,
      cropWidth: ocrCrop.rect.width,
      cropHeight: ocrCrop.rect.height,
      captureWidth: image.naturalWidth,
      captureHeight: image.naturalHeight,
    });

    await handleOcr(processedImage);

    return viewportImage;
  }

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

  const captureCameraImage = async () => {
    try {
      await captureVisibleViewport();
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
        const uploaded = await loadImage(base64String);
        const overlayRect = getOverlayRectInImageSpace(
          uploaded.naturalWidth,
          uploaded.naturalHeight,
          false,
        );
        const ocrCrop = await cropImageByRect(base64String, overlayRect);
        const processedImage = await preprocessImageForOcr(ocrCrop.image);
        const overlayDebug = await drawOverlayDebug(
          base64String,
          overlayRect,
          isDebugMode,
        );

        setCapturePreview({
          original: base64String,
          viewport: base64String,
          overlayDebug,
          cropped: ocrCrop.image,
          processed: processedImage,
        });
        setDebugInfo({
          captureWidth: uploaded.naturalWidth,
          captureHeight: uploaded.naturalHeight,
          cropX: ocrCrop.rect.x,
          cropY: ocrCrop.rect.y,
          cropWidth: ocrCrop.rect.width,
          cropHeight: ocrCrop.rect.height,
        });

        await handleOcr(processedImage);
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
            <p className={styles.previewTitle}>Visible Camera Viewport</p>
            <img
              src={capturePreview.viewport}
              alt="Visible camera viewport"
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
