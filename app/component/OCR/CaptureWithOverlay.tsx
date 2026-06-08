'use client';

import React, {useState, useRef} from 'react';
import {Camera} from 'react-camera-pro';
import Tesseract from 'tesseract.js';
import styles from './OcrScanner.module.css';

export default function OcrScanner() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cameraRef = useRef<any>(null);

  const [image, setImage] = useState<string | null>(null);
  const [extractedText, setExtractedText] = useState('');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);

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

  const captureCameraImage = () => {
    if (cameraRef.current) {
      const photo = cameraRef.current.takePhoto();
      setImage(photo);
      handleOcr(photo);
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

      {image && (
        <div className={styles.imagePreview}>
          <p className={styles.previewTitle}>Scanned Image:</p>

          <img src={image} alt="Preview" className={styles.previewImage} />
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
