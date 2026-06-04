'use client';

import React, {useState, useRef, useEffect} from 'react';
import Image from 'next/image';
import {Camera} from 'react-camera-pro';
import Tesseract from 'tesseract.js';
import styles from './OcrScanner.module.css';

type OverlayArea = {
  x: number;
  y: number;
  width: number;
  height: number;
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

  const [image, setImage] = useState<string | null>(null);
  const [extractedText, setExtractedText] = useState('');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [overlayArea, setOverlayArea] = useState<OverlayArea>(
    NIK_OVERLAY_PRESETS.mobile,
  );
  const [isCalibrationOpen, setIsCalibrationOpen] = useState(false);
  const [hasCustomOverlay, setHasCustomOverlay] = useState(false);

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

  const cropImageToNikArea = (imageSrc: string) =>
    new Promise<string>((resolve, reject) => {
      const img = document.createElement('img');

      img.onload = () => {
        const cropX = Math.floor(img.width * overlayArea.x);
        const cropY = Math.floor(img.height * overlayArea.y);
        const cropWidth = Math.floor(img.width * overlayArea.width);
        const cropHeight = Math.floor(img.height * overlayArea.height);

        const canvas = document.createElement('canvas');
        canvas.width = cropWidth;
        canvas.height = cropHeight;

        const context = canvas.getContext('2d');

        if (!context) {
          reject(new Error('Failed to get canvas context'));
          return;
        }

        context.drawImage(
          img,
          cropX,
          cropY,
          cropWidth,
          cropHeight,
          0,
          0,
          cropWidth,
          cropHeight,
        );

        resolve(canvas.toDataURL('image/jpeg', 0.95));
      };

      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = imageSrc;
    });

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
    if (cameraRef.current) {
      const photo = cameraRef.current.takePhoto();

      try {
        const croppedPhoto = await cropImageToNikArea(photo);
        setImage(croppedPhoto);
        handleOcr(croppedPhoto);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown crop error';
        setExtractedText(`Error cropping captured image: ${errorMessage}`);
      }
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];

    if (!file) return;

    const reader = new FileReader();

    reader.onloadend = () => {
      const base64String = reader.result as string;
      setImage(base64String);
      handleOcr(base64String);
    };

    reader.readAsDataURL(file);
  };

  return (
    <div className={styles.container}>
      <h1 className={styles.title}>Next.js Camera & Image OCR</h1>

      <div className={styles.cameraWrapper}>
        <Camera
          facingMode="environment"
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

      {image && (
        <div className={styles.imagePreview}>
          <p className={styles.previewTitle}>Scanned Image:</p>

          <Image
            src={image}
            alt="Preview"
            className={styles.previewImage}
            width={1024}
            height={320}
            unoptimized
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
