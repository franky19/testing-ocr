'use client';

import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Camera} from 'react-camera-pro';
import Tesseract from 'tesseract.js';

const DEBUG_OVERLAY = true;

type ViewportMapping = {
  imageWidth: number;
  imageHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  overlayLeft: number;
  overlayTop: number;
  overlayWidth: number;
  overlayHeight: number;
  renderedWidth: number;
  renderedHeight: number;
  scale: number;
  offsetX: number;
  offsetY: number;
  sourceX: number;
  sourceY: number;
  sourceWidth: number;
  sourceHeight: number;
};

type DebugOverlayData = {
  mapping: ViewportMapping;
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const loadImageFromSource = (imageSrc: string): Promise<HTMLImageElement> => {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Failed to load image for overlay crop.'));
    image.src = imageSrc;
  });
};

const calculateViewportMapping = ({
  imageWidth,
  imageHeight,
  viewportWidth,
  viewportHeight,
  overlayWidth,
  overlayHeight,
}: {
  imageWidth: number;
  imageHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  overlayWidth: number;
  overlayHeight: number;
}): ViewportMapping => {
  const scale = Math.max(viewportWidth / imageWidth, viewportHeight / imageHeight);
  const renderedWidth = imageWidth * scale;
  const renderedHeight = imageHeight * scale;
  const offsetX = (viewportWidth - renderedWidth) / 2;
  const offsetY = (viewportHeight - renderedHeight) / 2;

  const overlayLeft = (viewportWidth - overlayWidth) / 2;
  const overlayTop = (viewportHeight - overlayHeight) / 2;

  const sourceX1 = (overlayLeft - offsetX) / scale;
  const sourceY1 = (overlayTop - offsetY) / scale;
  const sourceX2 = (overlayLeft + overlayWidth - offsetX) / scale;
  const sourceY2 = (overlayTop + overlayHeight - offsetY) / scale;

  const clampedX1 = clamp(sourceX1, 0, imageWidth);
  const clampedY1 = clamp(sourceY1, 0, imageHeight);
  const clampedX2 = clamp(sourceX2, 0, imageWidth);
  const clampedY2 = clamp(sourceY2, 0, imageHeight);

  return {
    imageWidth,
    imageHeight,
    viewportWidth,
    viewportHeight,
    overlayLeft,
    overlayTop,
    overlayWidth,
    overlayHeight,
    renderedWidth,
    renderedHeight,
    scale,
    offsetX,
    offsetY,
    sourceX: clampedX1,
    sourceY: clampedY1,
    sourceWidth: Math.max(1, clampedX2 - clampedX1),
    sourceHeight: Math.max(1, clampedY2 - clampedY1),
  };
};

const cropImageToOverlay = async (imageSrc: string, mapping: ViewportMapping): Promise<string> => {
  const image = await loadImageFromSource(imageSrc);
  const canvas = document.createElement('canvas');

  canvas.width = Math.round(mapping.sourceWidth);
  canvas.height = Math.round(mapping.sourceHeight);

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Failed to create canvas context for overlay crop.');
  }

  context.drawImage(
    image,
    mapping.sourceX,
    mapping.sourceY,
    mapping.sourceWidth,
    mapping.sourceHeight,
    0,
    0,
    canvas.width,
    canvas.height,
  );

  return canvas.toDataURL('image/jpeg', 0.95);
};

const runOCR = async ({
  imageSrc,
  setProgress,
}: {
  imageSrc: string;
  setProgress: React.Dispatch<React.SetStateAction<number>>;
}) => {
  const result = await Tesseract.recognize(imageSrc, 'eng', {
    logger: message => {
      if (message.status === 'recognizing text') {
        setProgress(Math.round(message.progress * 100));
      }
    },
  });

  return result.data.text;
};

export default function OcrScanner() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cameraRef = useRef<any>(null);
  const cameraWrapperRef = useRef<HTMLDivElement | null>(null);

  const [image, setImage] = useState<string | null>(null);
  const [extractedText, setExtractedText] = useState('');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [overlayWidth, setOverlayWidth] = useState(350);
  const [overlayHeight, setOverlayHeight] = useState(70);
  const [cameraViewport, setCameraViewport] = useState({width: 0, height: 0});
  const [debugOverlayData, setDebugOverlayData] = useState<DebugOverlayData | null>(null);

  useEffect(() => {
    const wrapper = cameraWrapperRef.current;
    if (!wrapper) return;

    const updateSize = () => {
      setCameraViewport({
        width: wrapper.clientWidth,
        height: wrapper.clientHeight,
      });
    };

    updateSize();

    const observer = new ResizeObserver(() => {
      updateSize();
    });

    observer.observe(wrapper);

    return () => {
      observer.disconnect();
    };
  }, []);

  const effectiveOverlaySize = useMemo(() => {
    const safeWidth = Math.max(1, cameraViewport.width - 16);
    const safeHeight = Math.max(1, cameraViewport.height - 16);

    return {
      width: Math.min(overlayWidth, safeWidth),
      height: Math.min(overlayHeight, safeHeight),
    };
  }, [cameraViewport.height, cameraViewport.width, overlayHeight, overlayWidth]);

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

  const maskStyleBase: React.CSSProperties = {
    position: 'absolute',
    background: 'rgba(0, 0, 0, 0.5)',
    pointerEvents: 'none',
    zIndex: 2,
  };

  const overlayStyle: React.CSSProperties = {
    position: 'absolute',
    left: '50%',
    top: '50%',
    width: `${effectiveOverlaySize.width}px`,
    height: `${effectiveOverlaySize.height}px`,
    transform: 'translate(-50%, -50%)',
    border: '3px solid #00FF66',
    borderRadius: '8px',
    background: 'rgba(0, 255, 102, 0.12)',
    boxSizing: 'border-box',
    pointerEvents: 'none',
    zIndex: 3,
  };

  const overlayLabelStyle: React.CSSProperties = {
    position: 'absolute',
    left: '50%',
    top: '50%',
    transform: `translate(-50%, calc(-50% - ${effectiveOverlaySize.height / 2 + 18}px))`,
    background: 'rgba(0, 255, 102, 0.18)',
    color: '#d1fae5',
    border: '1px solid #00FF66',
    borderRadius: '6px',
    fontSize: '12px',
    fontWeight: 600,
    padding: '6px 10px',
    pointerEvents: 'none',
    whiteSpace: 'nowrap',
    zIndex: 3,
  };

  const controlsStyle: React.CSSProperties = {
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: '16px',
  };

  const slidersContainerStyle: React.CSSProperties = {
    width: '100%',
    display: 'grid',
    gridTemplateColumns: '1fr',
    gap: '12px',
    background: '#f8fafc',
    border: '1px solid #e2e8f0',
    borderRadius: '10px',
    padding: '12px',
  };

  const sliderLabelStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '12px',
    fontSize: '14px',
    color: '#334155',
    marginBottom: '6px',
  };

  const sliderInputStyle: React.CSSProperties = {
    width: '100%',
    accentColor: '#00aa4c',
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

  const debugPanelStyle: React.CSSProperties = {
    width: '100%',
    background: '#0f172a',
    color: '#e2e8f0',
    borderRadius: '8px',
    padding: '12px',
    fontSize: '12px',
    lineHeight: 1.5,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  };

  const executeOcr = async (imageSrc: string) => {
    setLoading(true);
    setExtractedText('');

    try {
      const text = await runOCR({imageSrc, setProgress});
      setExtractedText(text);
    } catch (error) {
      setExtractedText('Error extracting text.');
    } finally {
      setLoading(false);
      setProgress(0);
    }
  };

  const captureCameraImage = async () => {
    if (!cameraRef.current || !cameraWrapperRef.current) return;

    const photo = cameraRef.current.takePhoto();
    if (!photo) return;

    try {
      const capturedImage = await loadImageFromSource(photo);

      const mapping = calculateViewportMapping({
        imageWidth: capturedImage.naturalWidth,
        imageHeight: capturedImage.naturalHeight,
        viewportWidth: cameraWrapperRef.current.clientWidth,
        viewportHeight: cameraWrapperRef.current.clientHeight,
        overlayWidth: effectiveOverlaySize.width,
        overlayHeight: effectiveOverlaySize.height,
      });

      const croppedImage = await cropImageToOverlay(photo, mapping);
      setImage(croppedImage);

      if (DEBUG_OVERLAY) {
        setDebugOverlayData({mapping});
      }

      await executeOcr(croppedImage);
    } catch (error) {
      setExtractedText('Error processing overlay capture.');
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];

    if (!file) return;

    const reader = new FileReader();

    reader.onloadend = () => {
      const base64String = reader.result as string;
      setImage(base64String);
      executeOcr(base64String);
    };

    reader.readAsDataURL(file);
  };

  return (
    <div style={containerStyle}>
      <h1 style={titleStyle}>Next.js Camera & Image OCR</h1>

      <div style={cameraWrapperStyle} ref={cameraWrapperRef}>
        <Camera
          facingMode="environment"
          ref={cameraRef}
          aspectRatio={16 / 9}
          errorMessages={{
            noCameraAccessible: 'No camera device found',
          }}
        />

        <div
          style={{
            ...maskStyleBase,
            left: 0,
            top: 0,
            width: '100%',
            height: `calc(50% - ${effectiveOverlaySize.height / 2}px)`,
          }}
        />
        <div
          style={{
            ...maskStyleBase,
            left: 0,
            top: `calc(50% + ${effectiveOverlaySize.height / 2}px)`,
            width: '100%',
            height: `calc(50% - ${effectiveOverlaySize.height / 2}px)`,
          }}
        />
        <div
          style={{
            ...maskStyleBase,
            left: 0,
            top: `calc(50% - ${effectiveOverlaySize.height / 2}px)`,
            width: `calc(50% - ${effectiveOverlaySize.width / 2}px)`,
            height: `${effectiveOverlaySize.height}px`,
          }}
        />
        <div
          style={{
            ...maskStyleBase,
            left: `calc(50% + ${effectiveOverlaySize.width / 2}px)`,
            top: `calc(50% - ${effectiveOverlaySize.height / 2}px)`,
            width: `calc(50% - ${effectiveOverlaySize.width / 2}px)`,
            height: `${effectiveOverlaySize.height}px`,
          }}
        />

        <div style={overlayStyle} />
        <div style={overlayLabelStyle}>Posisikan NIK di dalam area ini</div>
      </div>

      <div style={slidersContainerStyle}>
        <div>
          <label style={sliderLabelStyle}>
            <span>Overlay Width</span>
            <span>{Math.round(effectiveOverlaySize.width)} px</span>
          </label>
          <input
            type="range"
            min={150}
            max={600}
            value={overlayWidth}
            onChange={event => setOverlayWidth(Number(event.target.value))}
            style={sliderInputStyle}
          />
        </div>

        <div>
          <label style={sliderLabelStyle}>
            <span>Overlay Height</span>
            <span>{Math.round(effectiveOverlaySize.height)} px</span>
          </label>
          <input
            type="range"
            min={40}
            max={200}
            value={overlayHeight}
            onChange={event => setOverlayHeight(Number(event.target.value))}
            style={sliderInputStyle}
          />
        </div>
      </div>

      {DEBUG_OVERLAY && (
        <div style={debugPanelStyle}>
          <div>DEBUG_OVERLAY: ON</div>
          <div>
            Viewport: {Math.round(cameraViewport.width)} x {Math.round(cameraViewport.height)} px
          </div>
          <div>
            Overlay: {Math.round(effectiveOverlaySize.width)} x {Math.round(effectiveOverlaySize.height)} px
          </div>
          {debugOverlayData && (
            <>
              <div>
                Image asli: {Math.round(debugOverlayData.mapping.imageWidth)} x {Math.round(debugOverlayData.mapping.imageHeight)} px
              </div>
              <div>Scaling ratio: {debugOverlayData.mapping.scale.toFixed(4)}</div>
              <div>
                Offset: X={debugOverlayData.mapping.offsetX.toFixed(2)}, Y={debugOverlayData.mapping.offsetY.toFixed(2)}
              </div>
              <div>
                Crop source: X={debugOverlayData.mapping.sourceX.toFixed(2)}, Y={debugOverlayData.mapping.sourceY.toFixed(2)}, W={debugOverlayData.mapping.sourceWidth.toFixed(2)}, H={debugOverlayData.mapping.sourceHeight.toFixed(2)}
              </div>
            </>
          )}
        </div>
      )}

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
