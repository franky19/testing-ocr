'use client';

import React, {useState, useRef} from 'react';
import {Camera} from 'react-camera-pro';
import Tesseract from 'tesseract.js';

export default function OcrScanner() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cameraRef = useRef<any>(null);

  const [image, setImage] = useState<string | null>(null);
  const [extractedText, setExtractedText] = useState('');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);

  const containerStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '24px',
    padding: '24px',
    maxWidth: '768px',
    margin: '0 auto',
  };

  const titleStyle: React.CSSProperties = {
    fontSize: '28px',
    fontWeight: 'bold',
  };

  const cameraWrapperStyle: React.CSSProperties = {
    position: 'relative',
    width: '100%',
    height: '320px',
    background: '#000',
    borderRadius: '12px',
    overflow: 'hidden',
  };

  const controlsStyle: React.CSSProperties = {
    display: 'flex',
    gap: '16px',
  };

  const buttonStyle: React.CSSProperties = {
    background: loading ? '#94a3b8' : '#2563eb',
    color: '#fff',
    padding: '12px 20px',
    border: 'none',
    borderRadius: '8px',
    cursor: loading ? 'not-allowed' : 'pointer',
    transition: 'background 0.2s ease',
  };

  const uploadButtonStyle: React.CSSProperties = {
    background: '#4b5563',
    color: '#fff',
    padding: '12px 20px',
    borderRadius: '8px',
    cursor: loading ? 'not-allowed' : 'pointer',
    transition: 'background 0.2s ease',
    opacity: loading ? 0.7 : 1,
  };

  const hiddenInputStyle: React.CSSProperties = {
    display: 'none',
  };

  const progressContainerStyle: React.CSSProperties = {
    width: '100%',
    height: '18px',
    background: '#e5e7eb',
    borderRadius: '999px',
    overflow: 'hidden',
  };

  const progressBarStyle: React.CSSProperties = {
    width: `${progress}%`,
    height: '100%',
    background: '#2563eb',
    color: '#fff',
    fontSize: '12px',
    textAlign: 'center',
    lineHeight: '18px',
    transition: 'width 0.3s ease',
  };

  const imagePreviewStyle: React.CSSProperties = {
    marginTop: '16px',
    width: '100%',
  };

  const previewTitleStyle: React.CSSProperties = {
    fontSize: '14px',
    fontWeight: 600,
    marginBottom: '8px',
  };

  const previewImageStyle: React.CSSProperties = {
    maxHeight: '300px',
    maxWidth: '100%',
    borderRadius: '8px',
    boxShadow: '0 2px 10px rgba(0, 0, 0, 0.15)',
  };

  const resultContainerStyle: React.CSSProperties = {
    width: '100%',
    background: '#f3f4f6',
    padding: '16px',
    borderRadius: '8px',
    border: '1px solid #d1d5db',
  };

  const resultTitleStyle: React.CSSProperties = {
    fontWeight: 'bold',
    color: '#374151',
    marginBottom: '8px',
  };

  const resultTextStyle: React.CSSProperties = {
    whiteSpace: 'pre-wrap',
    background: '#fff',
    padding: '12px',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    color: '#1f2937',
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
    <div style={containerStyle}>
      <h1 style={titleStyle}>Next.js Camera & Image OCR</h1>

      <div style={cameraWrapperStyle}>
        <Camera
          facingMode="environment"
          ref={cameraRef}
          aspectRatio={16 / 9}
          errorMessages={{
            noCameraAccessible: 'No camera device found',
          }}
        />
      </div>

      <div style={controlsStyle}>
        <button onClick={captureCameraImage} style={buttonStyle} disabled={loading}>
          Capture & Scan
        </button>

        <label style={uploadButtonStyle}>
          Upload Image
          <input
            type="file"
            accept="image/*"
            onChange={handleFileUpload}
            style={hiddenInputStyle}
            disabled={loading}
          />
        </label>
      </div>

      {loading && (
        <div style={progressContainerStyle}>
          <div style={progressBarStyle}>
            {progress}%
          </div>
        </div>
      )}

      {image && (
        <div style={imagePreviewStyle}>
          <p style={previewTitleStyle}>Scanned Image:</p>

          <img src={image} alt="Preview" style={previewImageStyle} />
        </div>
      )}

      {extractedText && (
        <div style={resultContainerStyle}>
          <p style={resultTitleStyle}>Extracted Text:</p>

          <div style={resultTextStyle}>{extractedText}</div>
        </div>
      )}
    </div>
  );
}
