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

    // object-fit: cover: scale so the video fills the container, then center.
    // offsetX/Y = how many rendered pixels are hidden behind each container edge.
    const scale = Math.max(
      containerWidth / videoWidth,
      containerHeight / videoHeight,
    );
    const renderedWidth = videoWidth * scale;
    const renderedHeight = videoHeight * scale;
    const offsetX = (renderedWidth - containerWidth) / 2;
    const offsetY = (renderedHeight - containerHeight) / 2;

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

  // ─────────────────────────────────────────────────────────────────────────
  // captureVisibleViewport
  //
  // ROOT CAUSE that was fixed:
  //   takePhoto() from react-camera-pro applies the <Camera aspectRatio={16/9}>
  //   prop, returning a CENTER-CROPPED landscape image (e.g. 480×269) even
  //   though the video stream is portrait (480×640).  This makes:
  //     scaleY = 269/640 = 0.42  →  every Y coordinate is wrong.
  //
  //   Fix: draw the <video> element onto a canvas directly.
  //   Canvas size = videoWidth × videoHeight → scaleX = scaleY = 1, no crop.
  //
  // Pipeline (object-fit: cover, scaleX=scaleY=1):
  //   canvas capture (480×640, same as stream)
  //     → viewport crop  : remove pixels hidden by cover  (x=offsetX, y=offsetY)
  //     → overlay crop   : apply overlay fractions to viewport image
  //     → OCR
  //
  // Key formula:
  //   scale    = Math.max(containerW/videoW, containerH/videoH)
  //   offsetX  = (videoW*scale − containerW) / 2   ← native px hidden each side
  //   offsetY  = (videoH*scale − containerH) / 2
  //
  //   viewport crop in native-video px:
  //     x = offsetX / scale,  y = offsetY / scale
  //     w = containerW / scale,  h = containerH / scale
  //
  //   overlay crop on viewport image (scaleX=scaleY=1 so no further scaling):
  //     x = overlayArea.x * viewportW
  //     y = overlayArea.y * viewportH
  // ─────────────────────────────────────────────────────────────────────────
  const captureVisibleViewport = async (): Promise<string> => {
    const videoElement = getVideoElement();
    if (!videoElement) throw new Error('Video element not found');

    const vvr = getVisibleVideoRect();
    if (!vvr) throw new Error('Video metadata is not ready');

    // ── Step 1: capture raw frame from <video> via canvas ─────────────────
    //   Dimensions exactly = videoWidth × videoHeight → scaleX = scaleY = 1
    const frameCanvas = document.createElement('canvas');
    frameCanvas.width = vvr.videoWidth;
    frameCanvas.height = vvr.videoHeight;
    const frameCtx = frameCanvas.getContext('2d');
    if (!frameCtx) throw new Error('Failed to get canvas 2d context');
    frameCtx.drawImage(videoElement, 0, 0, vvr.videoWidth, vvr.videoHeight);
    const fullPhoto = frameCanvas.toDataURL('image/jpeg', 0.95);

    // ── Step 2: crop to the area the user actually sees ────────────────────
    //   object-fit: cover hides offsetX/scale px on left+right,
    //                           offsetY/scale px on top+bottom
    const viewportCrop = await cropImageByRect(fullPhoto, {
      x: vvr.offsetX / vvr.scale,
      y: vvr.offsetY / vvr.scale,
      width: vvr.containerWidth / vvr.scale,
      height: vvr.containerHeight / vvr.scale,
    });

    // ── Step 3: overlay rect on viewport image ─────────────────────────────
    //   Overlay fractions (0–1) map directly to viewport image pixels
    const vpW = viewportCrop.rect.width;
    const vpH = viewportCrop.rect.height;
    const overlayRect: PixelRect = {
      x: overlayArea.x * vpW,
      y: overlayArea.y * vpH,
      width: overlayArea.width * vpW,
      height: overlayArea.height * vpH,
    };

    // ── Step 4: crop OCR area from viewport image ──────────────────────────
    const ocrCrop = await cropImageByRect(viewportCrop.image, overlayRect);

    // ── Step 5: draw red debug rectangle on viewport image ─────────────────
    const overlayDebug = await drawOverlayDebug(
      viewportCrop.image,
      overlayRect,
      isDebugMode,
    );

    const processedImage = await preprocessImageForOcr(ocrCrop.image);

    setCapturePreview({
      original: fullPhoto,
      viewport: viewportCrop.image,
      overlayDebug,
      cropped: ocrCrop.image,
      processed: processedImage,
    });

    setDebugInfo({
      videoWidth: vvr.videoWidth,
      videoHeight: vvr.videoHeight,
      containerWidth: Math.round(vvr.containerWidth),
      containerHeight: Math.round(vvr.containerHeight),
      renderedWidth: Math.round(vvr.renderedWidth),
      renderedHeight: Math.round(vvr.renderedHeight),
      scale: Number(vvr.scale.toFixed(4)),
      offsetX: Math.round(vvr.offsetX),
      offsetY: Math.round(vvr.offsetY),
      viewportCropX: viewportCrop.rect.x,
      viewportCropY: viewportCrop.rect.y,
      viewportCropWidth: viewportCrop.rect.width,
      viewportCropHeight: viewportCrop.rect.height,
      ocrCropX: ocrCrop.rect.x,
      ocrCropY: ocrCrop.rect.y,
      ocrCropWidth: ocrCrop.rect.width,
      ocrCropHeight: ocrCrop.rect.height,
      captureWidth: vvr.videoWidth,
      captureHeight: vvr.videoHeight,
    });

    await handleOcr(processedImage);

    return viewportCrop.image;
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
        // For uploaded images there is no camera scaling; treat image as viewport.
        // Overlay fractions map directly onto image dimensions.
        const uploaded = await loadImage(base64String);
        const imgW = uploaded.naturalWidth;
        const imgH = uploaded.naturalHeight;
        const overlayRect: PixelRect = {
          x: overlayArea.x * imgW,
          y: overlayArea.y * imgH,
          width: overlayArea.width * imgW,
          height: overlayArea.height * imgH,
        };
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
          captureWidth: imgW,
          captureHeight: imgH,
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
