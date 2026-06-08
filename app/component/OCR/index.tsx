'use client';

import React, {useEffect, useRef, useState} from 'react';
import {Camera} from 'react-camera-pro';
import {Rnd, RndDragCallback, RndResizeCallback} from 'react-rnd';
import Tesseract from 'tesseract.js';
import styles from './OcrScanner.module.css';
import {cropImageFromBase64} from './utils/cropImage';
import {Rect, getImageDimensions} from './utils/imageDimensions';
import {calculateViewportToImageCoordinates} from './utils/viewportMapper';

interface CameraHandle {
  takePhoto: (type?: 'base64url' | 'imgData') => string | ImageData;
}

interface Size {
  width: number;
  height: number;
}

const MIN_VIEWPORT_WIDTH = 120;
const MIN_VIEWPORT_HEIGHT = 90;

const clamp = (value: number, min: number, max: number): number => {
  if (value < min) {
    return min;
  }

  if (value > max) {
    return max;
  }

  return value;
};

const createDefaultViewport = (cameraSize: Size): Rect => {
  const defaultWidth = clamp(cameraSize.width * 0.72, 180, cameraSize.width);
  const defaultHeight = clamp(cameraSize.height * 0.36, 110, cameraSize.height);

  return {
    x: Math.max(0, (cameraSize.width - defaultWidth) / 2),
    y: Math.max(0, (cameraSize.height - defaultHeight) / 2),
    width: defaultWidth,
    height: defaultHeight,
  };
};

const clampViewportToContainer = (viewport: Rect, cameraSize: Size): Rect => {
  const maxWidth = Math.max(MIN_VIEWPORT_WIDTH, cameraSize.width);
  const maxHeight = Math.max(MIN_VIEWPORT_HEIGHT, cameraSize.height);
  const width = clamp(viewport.width, MIN_VIEWPORT_WIDTH, maxWidth);
  const height = clamp(viewport.height, MIN_VIEWPORT_HEIGHT, maxHeight);
  const x = clamp(viewport.x, 0, Math.max(0, cameraSize.width - width));
  const y = clamp(viewport.y, 0, Math.max(0, cameraSize.height - height));

  return {
    x,
    y,
    width,
    height,
  };
};

export default function OcrScanner() {
  const cameraRef = useRef<CameraHandle | null>(null);
  const cameraWrapperRef = useRef<HTMLDivElement | null>(null);

  const [originalImage, setOriginalImage] = useState<string | null>(null);
  const [croppedImage, setCroppedImage] = useState<string | null>(null);
  const [extractedText, setExtractedText] = useState('');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [cameraSize, setCameraSize] = useState<Size>({width: 0, height: 0});
  const [viewport, setViewport] = useState<Rect>({
    x: 100,
    y: 80,
    width: 300,
    height: 150,
  });

  useEffect(() => {
    const cameraWrapper = cameraWrapperRef.current;

    if (!cameraWrapper) {
      return;
    }

    const updateSize = () => {
      const nextSize: Size = {
        width: cameraWrapper.clientWidth,
        height: cameraWrapper.clientHeight,
      };

      setCameraSize(nextSize);
      setViewport(prevViewport => {
        if (nextSize.width === 0 || nextSize.height === 0) {
          return prevViewport;
        }

        const isUninitialized = prevViewport.width > nextSize.width;

        if (isUninitialized) {
          return createDefaultViewport(nextSize);
        }

        return clampViewportToContainer(prevViewport, nextSize);
      });
    };

    updateSize();

    const resizeObserver = new ResizeObserver(() => {
      updateSize();
    });

    resizeObserver.observe(cameraWrapper);
    window.addEventListener('resize', updateSize);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', updateSize);
    };
  }, []);

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
      setExtractedText('Error extracting text.');
    } finally {
      setLoading(false);
      setProgress(0);
    }
  };

  const handleViewportDragStop: RndDragCallback = (_event, data) => {
    setViewport(prevViewport =>
      clampViewportToContainer(
        {
          ...prevViewport,
          x: data.x,
          y: data.y,
        },
        cameraSize,
      ),
    );
  };

  const handleViewportResizeStop: RndResizeCallback = (
    _event,
    _direction,
    ref,
    _delta,
    position,
  ) => {
    setViewport(
      clampViewportToContainer(
        {
          x: position.x,
          y: position.y,
          width: ref.offsetWidth,
          height: ref.offsetHeight,
        },
        cameraSize,
      ),
    );
  };

  const captureCameraImage = async () => {
    if (!cameraRef.current || cameraSize.width === 0 || cameraSize.height === 0) {
      return;
    }

    const captured = cameraRef.current.takePhoto();

    if (typeof captured !== 'string') {
      setExtractedText('Error extracting text.');
      return;
    }

    try {
      const fullImage = captured;
      const imageDimensions = await getImageDimensions(fullImage);
      const cropRect = calculateViewportToImageCoordinates({
        viewport,
        container: cameraSize,
        image: imageDimensions,
      });
      const cropped = await cropImageFromBase64(fullImage, cropRect);

      setOriginalImage(fullImage);
      setCroppedImage(cropped);
      await handleOcr(cropped);
    } catch (error) {
      setExtractedText('Error extracting text.');
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];

    if (!file) return;

    const reader = new FileReader();

    reader.onloadend = () => {
      const base64String = reader.result as string;
      setOriginalImage(base64String);
      setCroppedImage(base64String);
      handleOcr(base64String);
    };

    reader.readAsDataURL(file);
  };

  return (
    <div className={styles.container}>
      <h1 className={styles.title}>Next.js Camera & Image OCR</h1>

      <div className={styles.cameraWrapper} ref={cameraWrapperRef}>
        <Camera
          facingMode="environment"
          ref={cameraRef as React.RefObject<unknown>}
          aspectRatio={16 / 9}
          errorMessages={{
            noCameraAccessible: 'No camera device found',
          }}
        />

        {cameraSize.width > 0 && cameraSize.height > 0 && (
          <div className={styles.viewportLayer}>
            <Rnd
              bounds="parent"
              className={styles.viewportRnd}
              size={{width: viewport.width, height: viewport.height}}
              position={{x: viewport.x, y: viewport.y}}
              minWidth={MIN_VIEWPORT_WIDTH}
              minHeight={MIN_VIEWPORT_HEIGHT}
              enableResizing={{
                top: false,
                right: false,
                bottom: false,
                left: false,
                topRight: true,
                bottomRight: true,
                bottomLeft: true,
                topLeft: true,
              }}
              resizeHandleClasses={{
                topLeft: styles.topLeftHandle,
                topRight: styles.topRightHandle,
                bottomLeft: styles.bottomLeftHandle,
                bottomRight: styles.bottomRightHandle,
              }}
              onDragStop={handleViewportDragStop}
              onResizeStop={handleViewportResizeStop}>
              <div className={styles.viewportContent}>
                <span className={styles.viewportLabel}>OCR AREA</span>
              </div>
            </Rnd>
          </div>
        )}
      </div>

      <div className={styles.controls}>
        <button
          onClick={captureCameraImage}
          className={styles.button}
          disabled={loading}>
          Capture & Scan
        </button>

        <label className={styles.uploadButton}>
          Upload Image
          <input
            type="file"
            accept="image/*"
            onChange={handleFileUpload}
            className={styles.hiddenInput}
            disabled={loading}
          />
        </label>
      </div>

      {loading && (
        <div className={styles.progressContainer}>
          <div className={styles.progressBar} style={{width: `${progress}%`}}>
            {progress}%
          </div>
        </div>
      )}

      {originalImage && (
        <div className={styles.imagePreview}>
          <p className={styles.previewTitle}>Original camera capture:</p>

          <img
            src={originalImage}
            alt="Original capture"
            className={styles.previewImage}
          />
        </div>
      )}

      {croppedImage && (
        <div className={styles.imagePreview}>
          <p className={styles.previewTitle}>Cropped OCR area:</p>

          <img
            src={croppedImage}
            alt="Cropped OCR area"
            className={styles.previewImage}
          />
        </div>
      )}

      {extractedText && (
        <div className={styles.resultContainer}>
          <p className={styles.resultTitle}>Extracted Text:</p>

          <div className={styles.resultText}>{extractedText}</div>
        </div>
      )}
    </div>
  );
}
