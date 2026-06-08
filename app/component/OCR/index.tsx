"use client";

import React, { useState, useRef } from "react";
import { Camera } from "react-camera-pro";
import Tesseract from "tesseract.js";

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 24,
    padding: 24,
    maxWidth: 768,
    margin: "0 auto",
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
  },
  cameraWrapper: {
    position: "relative",
    width: "100%",
    height: 320,
    background: "#000",
    borderRadius: 12,
    overflow: "hidden",
  },
  controls: {
    display: "flex",
    gap: 16,
  },
  button: {
    color: "#fff",
    padding: "12px 20px",
    border: "none",
    borderRadius: 8,
    cursor: "pointer",
    transition: "background 0.2s ease",
  },
  uploadButton: {
    color: "#fff",
    padding: "12px 20px",
    borderRadius: 8,
    cursor: "pointer",
    transition: "background 0.2s ease",
  },
  hiddenInput: {
    display: "none",
  },
  progressContainer: {
    width: "100%",
    height: 18,
    background: "#e5e7eb",
    borderRadius: 999,
    overflow: "hidden",
  },
  progressBar: {
    height: "100%",
    background: "#2563eb",
    color: "#fff",
    fontSize: 12,
    textAlign: "center",
    lineHeight: "18px",
    transition: "width 0.3s ease",
  },
  imagePreview: {
    marginTop: 16,
    width: "100%",
  },
  previewTitle: {
    fontSize: 14,
    fontWeight: 600,
    marginBottom: 8,
  },
  previewImage: {
    maxHeight: 300,
    maxWidth: "100%",
    borderRadius: 8,
    boxShadow: "0 2px 10px rgba(0, 0, 0, 0.15)",
  },
  resultContainer: {
    width: "100%",
    background: "#f3f4f6",
    padding: 16,
    borderRadius: 8,
    border: "1px solid #d1d5db",
  },
  resultTitle: {
    fontWeight: "bold",
    color: "#374151",
    marginBottom: 8,
  },
  resultText: {
    whiteSpace: "pre-wrap",
    background: "#fff",
    padding: 12,
    border: "1px solid #d1d5db",
    borderRadius: 6,
    color: "#1f2937",
  },
};

/**
 * Crops a full-resolution camera capture down to the exact pixels that are
 * visible inside `viewportEl` when the camera video uses `object-fit: cover`.
 *
 * How the math works
 * ──────────────────
 * Given:
 *   iw, ih  — original image dimensions  (img.naturalWidth / naturalHeight)
 *   vw, vh  — viewport element dimensions (getBoundingClientRect)
 *
 * With object-fit: cover the browser scales the image uniformly so that it
 * fills the viewport completely (no letterboxing), then centres it.
 * The scale factor applied is:
 *
 *   scale = max(vw / iw, vh / ih)
 *
 * After scaling, the rendered image size is (iw·scale) × (ih·scale).
 * The portion that overflows outside the viewport is clipped equally on both
 * sides, so the crop origin in image-space is:
 *
 *   srcX = ((iw·scale − vw) / 2) / scale  =  (iw − vw/scale) / 2
 *   srcY = ((ih·scale − vh) / 2) / scale  =  (ih − vh/scale) / 2
 *
 * The source crop size in image-space is:
 *
 *   srcW = vw / scale
 *   srcH = vh / scale
 *
 * We draw that region onto a canvas sized vw × vh, producing a 1:1 match with
 * exactly what the user sees in the browser.
 */
async function captureVisibleViewport(
  fullResBase64: string,
  viewportEl: HTMLElement
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();

    img.onload = () => {
      const { width: vw, height: vh } =
        viewportEl.getBoundingClientRect();

      const iw = img.naturalWidth;
      const ih = img.naturalHeight;

      // Scale factor used by object-fit: cover
      const scale = Math.max(vw / iw, vh / ih);

      // Source rectangle in original image coordinates
      const srcX = (iw - vw / scale) / 2;
      const srcY = (ih - vh / scale) / 2;
      const srcW = vw / scale;
      const srcH = vh / scale;

      // Draw only the visible portion onto a canvas matching the viewport size
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(vw);
      canvas.height = Math.round(vh);

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Could not get 2D canvas context"));
        return;
      }

      ctx.drawImage(
        img,
        srcX, srcY, srcW, srcH,   // source: visible region in image-space
        0, 0, canvas.width, canvas.height  // destination: full canvas
      );

      resolve(canvas.toDataURL("image/jpeg", 0.92));
    };

    img.onerror = () => reject(new Error("Failed to load captured image"));
    img.src = fullResBase64;
  });
}

export default function OcrScanner() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cameraRef = useRef<any>(null);
  const cameraWrapperRef = useRef<HTMLDivElement>(null);

  const [image, setImage] = useState<string | null>(null);
  const [extractedText, setExtractedText] = useState("");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);

  const handleOcr = async (imageSrc: string) => {
    setLoading(true);
    setExtractedText("");

    try {
      const result = await Tesseract.recognize(imageSrc, "eng", {
        logger: (m) => {
          if (m.status === "recognizing text") {
            setProgress(Math.round(m.progress * 100));
          }
        },
      });

      setExtractedText(result.data.text);
    } catch (error) {
      setExtractedText("Error extracting text.");
    } finally {
      setLoading(false);
      setProgress(0);
    }
  };

  const captureCameraImage = async () => {
    if (!cameraRef.current || !cameraWrapperRef.current) return;

    // 1. Take full-resolution photo from the camera hardware
    const fullPhoto: string = cameraRef.current.takePhoto();

    // 2. Crop the capture to match exactly what is visible in the viewport
    const croppedPhoto = await captureVisibleViewport(
      fullPhoto,
      cameraWrapperRef.current
    );

    // 3. Show the cropped preview and run OCR on it
    setImage(croppedPhoto);
    handleOcr(croppedPhoto);
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
    <div style={styles.container}>
      <h1 style={styles.title}>Next.js Camera & Image OCR</h1>

      <div style={styles.cameraWrapper} ref={cameraWrapperRef}>
        <Camera
          ref={cameraRef}
          aspectRatio={16 / 9}
          errorMessages={{
            noCameraAccessible: "No camera device found",
          }}
        />
      </div>

      <div style={styles.controls}>
        <button
          onClick={captureCameraImage}
          style={{
            ...styles.button,
            background: loading ? "#94a3b8" : "#2563eb",
            cursor: loading ? "not-allowed" : "pointer",
          }}
          disabled={loading}
        >
          Capture & Scan
        </button>

        <label
          style={{
            ...styles.uploadButton,
            background: loading ? "#94a3b8" : "#4b5563",
            cursor: loading ? "not-allowed" : "pointer",
          }}
        >
          Upload Image
          <input
            type="file"
            accept="image/*"
            onChange={handleFileUpload}
            style={styles.hiddenInput}
            disabled={loading}
          />
        </label>
      </div>

      {loading && (
        <div style={styles.progressContainer}>
          <div style={{ ...styles.progressBar, width: `${progress}%` }}>
            {progress}%
          </div>
        </div>
      )}

      {image && (
        <div style={styles.imagePreview}>
          <p style={styles.previewTitle}>Scanned Image:</p>

          <img src={image} alt="Preview" style={styles.previewImage} />
        </div>
      )}

      {extractedText && (
        <div style={styles.resultContainer}>
          <p style={styles.resultTitle}>Extracted Text:</p>

          <div style={styles.resultText}>{extractedText}</div>
        </div>
      )}
    </div>
  );
}
