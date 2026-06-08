"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Webcam from "react-webcam";
import Tesseract from "tesseract.js";

type CropArea = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type FrameValidation = {
  brightness: number;
  blurVariance: number;
  stabilityDelta: number;
  stableForMs: number;
  passed: boolean;
  reason: string;
};

type OcrState = {
  rawText: string;
  nik: string;
  phoneNumber: string;
  confidence: number;
  nikFound: boolean;
};

const OCR_AREA: CropArea = {
  x: 0.1,
  y: 0.15,
  width: 0.8,
  height: 0.2,
};

const OCR_INTERVAL_MS = 1200;
const STABILITY_REQUIRED_MS = 500;
const MIN_BRIGHTNESS = 70;
const MIN_LAPLACIAN_VARIANCE = 95;
const STABILITY_MAX_DELTA = 7.5;
const MAX_SOURCE_WIDTH = 1280;
const MAX_SOURCE_HEIGHT = 720;

const waitAnimationFrame = () => {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
};

const blobToDataUrl = (blob: Blob) => {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      resolve(String(reader.result || ""));
    };

    reader.onerror = () => {
      reject(new Error("Failed to read image blob"));
    };

    reader.readAsDataURL(blob);
  });
};

const parseNIK = (text: string) => {
  const nikRegex = /\b\d{16}\b/g;
  return text.match(nikRegex)?.[0] || "";
};

const parsePhoneNumber = (text: string) => {
  const phoneRegex = /(?:\+62|62|0)\d{9,13}/g;
  return text.match(phoneRegex)?.[0] || "";
};

const computeLaplacianVariance = (
  grayscale: Uint8ClampedArray,
  width: number,
  height: number,
) => {
  if (width < 3 || height < 3) {
    return 0;
  }

  let sum = 0;
  let sumSquared = 0;
  let count = 0;

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const idx = y * width + x;
      const lap =
        4 * grayscale[idx] -
        grayscale[idx - 1] -
        grayscale[idx + 1] -
        grayscale[idx - width] -
        grayscale[idx + width];

      sum += lap;
      sumSquared += lap * lap;
      count += 1;
    }
  }

  if (count === 0) {
    return 0;
  }

  const mean = sum / count;
  return sumSquared / count - mean * mean;
};

const createSignature = (
  grayscale: Uint8ClampedArray,
  width: number,
  height: number,
  gridW = 24,
  gridH = 14,
) => {
  const signature = new Float32Array(gridW * gridH);

  for (let gy = 0; gy < gridH; gy += 1) {
    const y0 = Math.floor((gy / gridH) * height);
    const y1 = Math.max(y0 + 1, Math.floor(((gy + 1) / gridH) * height));

    for (let gx = 0; gx < gridW; gx += 1) {
      const x0 = Math.floor((gx / gridW) * width);
      const x1 = Math.max(x0 + 1, Math.floor(((gx + 1) / gridW) * width));

      let sum = 0;
      let count = 0;

      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          sum += grayscale[y * width + x];
          count += 1;
        }
      }

      signature[gy * gridW + gx] = count > 0 ? sum / count : 0;
    }
  }

  return signature;
};

const signatureDelta = (prev: Float32Array | null, current: Float32Array) => {
  if (!prev || prev.length !== current.length) {
    return Number.POSITIVE_INFINITY;
  }

  let sumAbsDiff = 0;

  for (let i = 0; i < current.length; i += 1) {
    sumAbsDiff += Math.abs(current[i] - prev[i]);
  }

  return sumAbsDiff / current.length;
};

const clamp = (value: number, min: number, max: number) => {
  return Math.max(min, Math.min(max, value));
};

const computeCropInVideoSpace = (
  video: HTMLVideoElement,
  container: HTMLElement,
  area: CropArea,
) => {
  const videoWidth = video.videoWidth;
  const videoHeight = video.videoHeight;
  const containerRect = container.getBoundingClientRect();

  const containerWidth = containerRect.width;
  const containerHeight = containerRect.height;

  const videoAspect = videoWidth / videoHeight;
  const containerAspect = containerWidth / containerHeight;

  let displayedWidth = containerWidth;
  let displayedHeight = containerHeight;
  let offsetX = 0;
  let offsetY = 0;

  if (videoAspect > containerAspect) {
    displayedHeight = containerHeight;
    displayedWidth = containerHeight * videoAspect;
    offsetX = (displayedWidth - containerWidth) / 2;
  } else {
    displayedWidth = containerWidth;
    displayedHeight = containerWidth / videoAspect;
    offsetY = (displayedHeight - containerHeight) / 2;
  }

  const overlayX = area.x * containerWidth;
  const overlayY = area.y * containerHeight;
  const overlayW = area.width * containerWidth;
  const overlayH = area.height * containerHeight;

  const sx = clamp(
    ((overlayX + offsetX) / displayedWidth) * videoWidth,
    0,
    videoWidth - 1,
  );
  const sy = clamp(
    ((overlayY + offsetY) / displayedHeight) * videoHeight,
    0,
    videoHeight - 1,
  );
  const sw = clamp(
    (overlayW / displayedWidth) * videoWidth,
    1,
    videoWidth - sx,
  );
  const sh = clamp(
    (overlayH / displayedHeight) * videoHeight,
    1,
    videoHeight - sy,
  );

  return {
    sx,
    sy,
    sw,
    sh,
  };
};

const reduceNoiseBinary = (
  binary: Uint8ClampedArray,
  width: number,
  height: number,
) => {
  const output = new Uint8ClampedArray(binary);

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      let whiteCount = 0;
      let blackCount = 0;

      for (let ny = -1; ny <= 1; ny += 1) {
        for (let nx = -1; nx <= 1; nx += 1) {
          const value = binary[(y + ny) * width + (x + nx)];
          if (value > 127) {
            whiteCount += 1;
          } else {
            blackCount += 1;
          }
        }
      }

      output[y * width + x] = whiteCount >= blackCount ? 255 : 0;
    }
  }

  return output;
};

const sharpenGrayscale = (
  grayscale: Uint8ClampedArray,
  width: number,
  height: number,
) => {
  const output = new Uint8ClampedArray(grayscale);

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const idx = y * width + x;
      const value =
        5 * grayscale[idx] -
        grayscale[idx - 1] -
        grayscale[idx + 1] -
        grayscale[idx - width] -
        grayscale[idx + width];

      output[idx] = clamp(Math.round(value), 0, 255);
    }
  }

  return output;
};

const buildAdaptiveThreshold = (
  grayscale: Uint8ClampedArray,
  width: number,
  height: number,
  blockRadius = 8,
  offset = 10,
) => {
  const integral = new Uint32Array((width + 1) * (height + 1));

  for (let y = 1; y <= height; y += 1) {
    let rowSum = 0;
    for (let x = 1; x <= width; x += 1) {
      rowSum += grayscale[(y - 1) * width + (x - 1)];
      integral[y * (width + 1) + x] =
        integral[(y - 1) * (width + 1) + x] + rowSum;
    }
  }

  const binary = new Uint8ClampedArray(width * height);

  for (let y = 0; y < height; y += 1) {
    const y0 = Math.max(0, y - blockRadius);
    const y1 = Math.min(height - 1, y + blockRadius);

    for (let x = 0; x < width; x += 1) {
      const x0 = Math.max(0, x - blockRadius);
      const x1 = Math.min(width - 1, x + blockRadius);

      const A = integral[y0 * (width + 1) + x0];
      const B = integral[y0 * (width + 1) + (x1 + 1)];
      const C = integral[(y1 + 1) * (width + 1) + x0];
      const D = integral[(y1 + 1) * (width + 1) + (x1 + 1)];
      const area = (x1 - x0 + 1) * (y1 - y0 + 1);
      const mean = (D - B - C + A) / area;

      const pixel = grayscale[y * width + x];
      binary[y * width + x] = pixel > mean - offset ? 255 : 0;
    }
  }

  return binary;
};

const buildEnhancedFrame = async (
  video: HTMLVideoElement,
  container: HTMLElement,
  area: CropArea,
) => {
  const { sx, sy, sw, sh } = computeCropInVideoSpace(video, container, area);

  let targetWidth = Math.floor(sw);
  let targetHeight = Math.floor(sh);

  const scaleCap = Math.min(
    MAX_SOURCE_WIDTH / targetWidth,
    MAX_SOURCE_HEIGHT / targetHeight,
    1,
  );
  targetWidth = Math.max(1, Math.floor(targetWidth * scaleCap));
  targetHeight = Math.max(1, Math.floor(targetHeight * scaleCap));

  const supportsOffscreen = typeof OffscreenCanvas !== "undefined";
  const workingCanvas: OffscreenCanvas | HTMLCanvasElement = supportsOffscreen
    ? new OffscreenCanvas(targetWidth, targetHeight)
    : Object.assign(document.createElement("canvas"), {
        width: targetWidth,
        height: targetHeight,
      });

  const ctx = workingCanvas.getContext("2d", {
    willReadFrequently: true,
  }) as CanvasRenderingContext2D;

  if (!ctx) {
    throw new Error("Unable to create canvas context");
  }

  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, targetWidth, targetHeight);

  const imageData = ctx.getImageData(0, 0, targetWidth, targetHeight);
  const pixels = imageData.data;
  const grayscale = new Uint8ClampedArray(targetWidth * targetHeight);

  let brightnessSum = 0;
  for (let i = 0; i < grayscale.length; i += 1) {
    const di = i * 4;
    const gray =
      0.299 * pixels[di] + 0.587 * pixels[di + 1] + 0.114 * pixels[di + 2];
    grayscale[i] = Math.round(gray);
    brightnessSum += gray;
  }

  const brightness = brightnessSum / grayscale.length;
  const blurVariance = computeLaplacianVariance(
    grayscale,
    targetWidth,
    targetHeight,
  );

  const contrasted = new Uint8ClampedArray(grayscale.length);
  for (let i = 0; i < grayscale.length; i += 1) {
    contrasted[i] = clamp(
      Math.round((grayscale[i] - 128) * 1.35 + 128),
      0,
      255,
    );
  }

  const adaptive = buildAdaptiveThreshold(
    contrasted,
    targetWidth,
    targetHeight,
  );
  const denoised = reduceNoiseBinary(adaptive, targetWidth, targetHeight);
  const sharpened = sharpenGrayscale(denoised, targetWidth, targetHeight);

  for (let i = 0; i < sharpened.length; i += 1) {
    const di = i * 4;
    pixels[di] = sharpened[i];
    pixels[di + 1] = sharpened[i];
    pixels[di + 2] = sharpened[i];
    pixels[di + 3] = 255;
  }

  ctx.putImageData(imageData, 0, 0);

  const enhancedBlob = supportsOffscreen
    ? await (workingCanvas as OffscreenCanvas).convertToBlob({
        type: "image/png",
      })
    : await new Promise<Blob>((resolve, reject) => {
        (workingCanvas as HTMLCanvasElement).toBlob((blob) => {
          if (!blob) {
            reject(new Error("Failed to export enhanced image"));
            return;
          }

          resolve(blob);
        }, "image/png");
      });

  const rawCanvas = document.createElement("canvas");
  rawCanvas.width = targetWidth;
  rawCanvas.height = targetHeight;
  const rawCtx = rawCanvas.getContext("2d");
  if (!rawCtx) {
    throw new Error("Unable to build raw preview");
  }

  rawCtx.drawImage(video, sx, sy, sw, sh, 0, 0, targetWidth, targetHeight);

  return {
    enhancedBlob,
    enhancedDataUrl: await blobToDataUrl(enhancedBlob),
    rawDataUrl: rawCanvas.toDataURL("image/png"),
    brightness,
    blurVariance,
    signature: createSignature(grayscale, targetWidth, targetHeight),
    sourceSize: `${targetWidth}x${targetHeight}`,
  };
};

const initialResult: OcrState = {
  rawText: "",
  nik: "",
  phoneNumber: "",
  confidence: 0,
  nikFound: false,
};

export const DirectCameraOcr = () => {
  const webcamRef = useRef<Webcam | null>(null);
  const webcamContainerRef = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const processingRef = useRef(false);
  const previousSignatureRef = useRef<Float32Array | null>(null);
  const stableSinceRef = useRef<number | null>(null);
  const lastResultRef = useRef<string>("");
  const sameResultCountRef = useRef(0);

  const [cameraReady, setCameraReady] = useState(false);
  const [locked, setLocked] = useState(false);
  const [running, setRunning] = useState(true);
  const [numbersOnly, setNumbersOnly] = useState(true);
  const [debugMode, setDebugMode] = useState(false);
  const [statusText, setStatusText] = useState("Open camera");
  const [errorText, setErrorText] = useState("");
  const [result, setResult] = useState<OcrState>(initialResult);
  const [validation, setValidation] = useState<FrameValidation>({
    brightness: 0,
    blurVariance: 0,
    stabilityDelta: 0,
    stableForMs: 0,
    passed: false,
    reason: "Waiting camera",
  });
  const [rawPreview, setRawPreview] = useState("");
  const [enhancedPreview, setEnhancedPreview] = useState("");
  const [sourceSize, setSourceSize] = useState("-");

  const videoConstraints = useMemo(() => {
    return {
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      facingMode: {
        ideal: "environment",
      },
      aspectRatio: 16 / 9,
    };
  }, []);

  const validateFrame = (
    brightness: number,
    blurVariance: number,
    stabilityDelta: number,
    stableForMs: number,
  ): FrameValidation => {
    if (brightness < MIN_BRIGHTNESS) {
      return {
        brightness,
        blurVariance,
        stabilityDelta,
        stableForMs,
        passed: false,
        reason: "Brightness too low",
      };
    }

    if (blurVariance < MIN_LAPLACIAN_VARIANCE) {
      return {
        brightness,
        blurVariance,
        stabilityDelta,
        stableForMs,
        passed: false,
        reason: "Image is blurry",
      };
    }

    if (stableForMs < STABILITY_REQUIRED_MS) {
      return {
        brightness,
        blurVariance,
        stabilityDelta,
        stableForMs,
        passed: false,
        reason: "Hold steady for 500ms",
      };
    }

    return {
      brightness,
      blurVariance,
      stabilityDelta,
      stableForMs,
      passed: true,
      reason: "Frame valid",
    };
  };

  const clearLoop = () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const scheduleNext = () => {
    clearLoop();
    timerRef.current = window.setTimeout(() => {
      runOcrCycle();
    }, OCR_INTERVAL_MS);
  };

  const runOcrCycle = async () => {
    if (processingRef.current || !running || locked) {
      scheduleNext();
      return;
    }

    const video = webcamRef.current?.video;
    const container = webcamContainerRef.current;

    if (!video || !container || !cameraReady || video.videoWidth === 0) {
      setStatusText("Waiting camera stream");
      scheduleNext();
      return;
    }

    processingRef.current = true;

    try {
      setErrorText("");
      setStatusText("Capture frame from camera");

      await waitAnimationFrame();

      const frame = await buildEnhancedFrame(video, container, OCR_AREA);
      setRawPreview(frame.rawDataUrl);
      setEnhancedPreview(frame.enhancedDataUrl);
      setSourceSize(frame.sourceSize);

      const now = performance.now();
      const delta = signatureDelta(
        previousSignatureRef.current,
        frame.signature,
      );
      previousSignatureRef.current = frame.signature;

      if (delta <= STABILITY_MAX_DELTA) {
        if (stableSinceRef.current === null) {
          stableSinceRef.current = now;
        }
      } else {
        stableSinceRef.current = null;
      }

      const stableForMs =
        stableSinceRef.current === null
          ? 0
          : Math.max(0, now - stableSinceRef.current);
      const frameValidation = validateFrame(
        frame.brightness,
        frame.blurVariance,
        Number.isFinite(delta) ? delta : 0,
        stableForMs,
      );

      setValidation(frameValidation);

      if (!frameValidation.passed) {
        setStatusText(`Detect OCR area: ${frameValidation.reason}`);
        scheduleNext();
        return;
      }

      setStatusText("Image enhancement complete, running OCR");

      const ocrConfig: Record<string, string> = {
        tessedit_pageseg_mode: "7",
        preserve_interword_spaces: "1",
      };

      if (numbersOnly) {
        ocrConfig.tessedit_char_whitelist = "0123456789";
      }

      const ocrResult = await (Tesseract as any).recognize(
        frame.enhancedBlob,
        "eng",
        ocrConfig,
      );
      const rawText = String(ocrResult?.data?.text || "").trim();
      const confidence = Number(ocrResult?.data?.confidence || 0);
      const nik = parseNIK(rawText);
      const phoneNumber = parsePhoneNumber(rawText);

      setResult({
        rawText,
        nik,
        phoneNumber,
        confidence,
        nikFound: Boolean(nik),
      });

      if (rawText && rawText === lastResultRef.current) {
        sameResultCountRef.current += 1;
      } else {
        sameResultCountRef.current = 1;
        lastResultRef.current = rawText;
      }

      if (confidence >= 90 && sameResultCountRef.current >= 3 && rawText) {
        setLocked(true);
        setRunning(false);
        setStatusText("OCR Locked");
        clearLoop();
        return;
      }

      setStatusText("OCR completed, capture frame again");
      scheduleNext();
    } catch (err) {
      setErrorText(
        err instanceof Error ? err.message : "Failed to process frame",
      );
      setStatusText("OCR error, retrying");
      scheduleNext();
    } finally {
      processingRef.current = false;
    }
  };

  useEffect(() => {
    if (!cameraReady || !running || locked) {
      clearLoop();
      return;
    }

    runOcrCycle();

    return () => {
      clearLoop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraReady, running, locked, numbersOnly]);

  useEffect(() => {
    return () => {
      clearLoop();
    };
  }, []);

  const nikStatusText = result.nikFound ? "NIK Found" : "Searching NIK...";

  return (
    <div
      style={{
        minHeight: "100vh",
        padding: "20px",
        background:
          "linear-gradient(160deg, #f7f3e8 0%, #f2f8ff 55%, #e9f7ee 100%)",
      }}
    >
      <div
        style={{
          maxWidth: 980,
          margin: "0 auto",
          background: "#ffffff",
          border: "1px solid #d9e2ec",
          borderRadius: 18,
          padding: 18,
          boxShadow: "0 18px 45px rgba(15, 23, 42, 0.1)",
        }}
      >
        <h1 style={{ marginTop: 0, marginBottom: 10 }}>
          Direct Camera OCR Mode
        </h1>
        <p style={{ marginTop: 0, marginBottom: 16, color: "#334155" }}>
          Open Camera - Live Preview - Detect OCR Area - Auto Capture - Image
          Enhancement - OCR
        </p>

        <div
          ref={webcamContainerRef}
          style={{
            position: "relative",
            width: "100%",
            aspectRatio: "16 / 9",
            borderRadius: 14,
            border: "1px solid #cbd5e1",
            overflow: "hidden",
            background: "#0f172a",
          }}
        >
          <Webcam
            ref={webcamRef}
            audio={false}
            mirrored={false}
            forceScreenshotSourceSize
            screenshotFormat="image/png"
            videoConstraints={videoConstraints}
            onUserMedia={() => {
              setCameraReady(true);
              setStatusText("Camera active");
            }}
            onUserMediaError={() => {
              setCameraReady(false);
              setErrorText("Cannot access camera. Please allow permission.");
            }}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
            }}
          />

          <div
            style={{
              position: "absolute",
              left: `${OCR_AREA.x * 100}%`,
              top: `${OCR_AREA.y * 100}%`,
              width: `${OCR_AREA.width * 100}%`,
              height: `${OCR_AREA.height * 100}%`,
              border: "2px solid #22c55e",
              borderRadius: 8,
              boxShadow: "0 0 0 9999px rgba(2, 6, 23, 0.38)",
              pointerEvents: "none",
            }}
          />

          <div
            style={{
              position: "absolute",
              left: 12,
              top: 12,
              padding: "5px 10px",
              borderRadius: 999,
              background: "rgba(2, 6, 23, 0.68)",
              color: "#e2e8f0",
              fontSize: 12,
              letterSpacing: 0.3,
            }}
          >
            OCR AREA
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
            marginTop: 12,
            alignItems: "center",
          }}
        >
          <button
            type="button"
            onClick={() => {
              setLocked(false);
              setRunning(true);
              setStatusText("Restart auto OCR loop");
              sameResultCountRef.current = 0;
              lastResultRef.current = "";
              stableSinceRef.current = null;
            }}
            style={{
              border: "1px solid #94a3b8",
              borderRadius: 8,
              padding: "8px 12px",
              cursor: "pointer",
              background: "#f8fafc",
              fontWeight: 600,
            }}
          >
            Restart Scan
          </button>

          <button
            type="button"
            onClick={() => {
              setRunning((prev) => !prev);
              setStatusText((prev) => (running ? "OCR paused" : "OCR resumed"));
            }}
            style={{
              border: "1px solid #94a3b8",
              borderRadius: 8,
              padding: "8px 12px",
              cursor: "pointer",
              background: "#f8fafc",
              fontWeight: 600,
            }}
          >
            {running ? "Pause Loop" : "Resume Loop"}
          </button>

          <label
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <input
              type="checkbox"
              checked={numbersOnly}
              onChange={(event) => {
                setNumbersOnly(event.target.checked);
              }}
            />
            Digits only mode
          </label>
          <label
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <input
              type="checkbox"
              checked={debugMode}
              onChange={(event) => {
                setDebugMode(event.target.checked);
              }}
            />
            Debug mode
          </label>
        </div>

        {debugMode && (
          <div
            style={{
              marginTop: 14,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 10,
            }}
          >
            <div
              style={{
                background: "#f8fafc",
                borderRadius: 10,
                padding: 10,
                border: "1px solid #e2e8f0",
              }}
            >
              <strong>Status</strong>
              <div>{statusText}</div>
            </div>
            <div
              style={{
                background: "#f8fafc",
                borderRadius: 10,
                padding: 10,
                border: "1px solid #e2e8f0",
              }}
            >
              <strong>OCR Confidence</strong>
              <div>{result.confidence.toFixed(1)}%</div>
            </div>
            <div
              style={{
                background: "#f8fafc",
                borderRadius: 10,
                padding: 10,
                border: "1px solid #e2e8f0",
              }}
            >
              <strong>NIK Status</strong>
              <div>{nikStatusText}</div>
            </div>
            <div
              style={{
                background: "#f8fafc",
                borderRadius: 10,
                padding: 10,
                border: "1px solid #e2e8f0",
              }}
            >
              <strong>Source Size</strong>
              <div>{sourceSize}</div>
            </div>
          </div>
        )}

        <div
          style={{
            marginTop: 12,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 10,
          }}
        >
          {debugMode && (
            <div
              style={{
                background: "#fff7ed",
                borderRadius: 10,
                padding: 10,
                border: "1px solid #fdba74",
              }}
            >
              <div>Brightness: {validation.brightness.toFixed(1)}</div>
              <div>
                Blur (Laplacian Var): {validation.blurVariance.toFixed(1)}
              </div>
              <div>Stability Delta: {validation.stabilityDelta.toFixed(2)}</div>
              <div>Stable For: {Math.round(validation.stableForMs)} ms</div>
            </div>
          )}
          <div
            style={{
              background: "#f0fdf4",
              borderRadius: 10,
              padding: 10,
              border: "1px solid #86efac",
            }}
          >
            <div>Validation: {validation.passed ? "PASS" : "WAIT"}</div>
            <div>Reason: {validation.reason}</div>
            <div>Locked: {locked ? "YES" : "NO"}</div>
            <div>Repeat Match: {sameResultCountRef.current}/3</div>
          </div>
        </div>

        <div
          style={{
            marginTop: 18,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: 12,
          }}
        >
          {debugMode && (
            <div
              style={{
                border: "1px solid #dbeafe",
                borderRadius: 10,
                padding: 10,
                background: "#eff6ff",
              }}
            >
              <h3 style={{ margin: "0 0 8px" }}>Raw OCR Result</h3>
              <pre style={{ margin: 0, whiteSpace: "pre-wrap", minHeight: 90 }}>
                {result.rawText || "-"}
              </pre>
            </div>
          )}
          <div
            style={{
              border: "1px solid #dbeafe",
              borderRadius: 10,
              padding: 10,
              background: "#eff6ff",
            }}
          >
            <h3 style={{ margin: "0 0 8px" }}>Detected Data</h3>
            <div>Detected NIK: {result.nik || "-"}</div>
            <div>Detected Phone Number: {result.phoneNumber || "-"}</div>
            <div>Confidence: {result.confidence.toFixed(1)}%</div>
            <div>Engine: Tesseract.recognize()</div>
          </div>
        </div>

        {(rawPreview || enhancedPreview) && (
          <div
            style={{
              marginTop: 16,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
              gap: 12,
            }}
          >
            {rawPreview && (
              <div
                style={{
                  border: "1px solid #e2e8f0",
                  borderRadius: 10,
                  padding: 10,
                }}
              >
                <h3 style={{ margin: "0 0 8px" }}>Crop Preview</h3>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={rawPreview}
                  alt="Crop Preview"
                  style={{
                    width: "100%",
                    borderRadius: 8,
                    border: "1px solid #cbd5e1",
                  }}
                />
              </div>
            )}
            {enhancedPreview && (
              <div
                style={{
                  border: "1px solid #e2e8f0",
                  borderRadius: 10,
                  padding: 10,
                }}
              >
                <h3 style={{ margin: "0 0 8px" }}>Enhanced Preview</h3>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={enhancedPreview}
                  alt="Enhanced Preview"
                  style={{
                    width: "100%",
                    borderRadius: 8,
                    border: "1px solid #cbd5e1",
                    background: "#fff",
                  }}
                />
              </div>
            )}
          </div>
        )}

        {errorText && (
          <div
            style={{
              marginTop: 14,
              border: "1px solid #fca5a5",
              borderRadius: 10,
              padding: 10,
              background: "#fef2f2",
              color: "#7f1d1d",
            }}
          >
            {errorText}
          </div>
        )}
      </div>
    </div>
  );
};
