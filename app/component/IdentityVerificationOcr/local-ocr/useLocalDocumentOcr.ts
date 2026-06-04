import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {buildConfidenceEngine} from './confidence';
import {LocalOcrResult} from './types';
import {buildIdentityFields} from './validation';

type OcrStage = {stage: string; progress: number};
const OCR_STALL_TIMEOUT_MS = 20000;

const toDataUrl = async (file: File) => {
  const isImage = file.type.startsWith('image/');
  if (!isImage) {
    throw new Error('Unsupported file type. Upload jpg/jpeg/png/heic image.');
  }

  try {
    const bitmap = await createImageBitmap(file, {
      imageOrientation: 'from-image',
    });
    const maxSide = 2200;
    const longest = Math.max(bitmap.width, bitmap.height);
    const scale = longest > maxSide ? maxSide / longest : 1;

    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Canvas context unavailable for image preprocessing.');
    }

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', 0.92);
  } catch (decodeError) {
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () =>
        reject(new Error('Failed to read uploaded image.'));
      reader.onload = () => resolve(String(reader.result || ''));
      reader.readAsDataURL(file);
    });
  }
};

const createRequestId = () =>
  `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export const useLocalDocumentOcr = (params: {
  workerBasePath?: string;
  workerVersion: string;
  debug?: boolean;
}) => {
  const {workerBasePath = '/activation', workerVersion, debug = false} = params;
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [stage, setStage] = useState<OcrStage>({stage: 'Idle', progress: 0});
  const [result, setResult] = useState<LocalOcrResult | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef('');
  const latestFileRef = useRef<File | null>(null);
  const latestImageSrcRef = useRef('');
  const latestImageBytesRef = useRef<ArrayBuffer | null>(null);
  const skipOpenCvRef = useRef(false);
  const autoFallbackAttemptedRef = useRef(false);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restartWithoutOpenCvRef = useRef<((requestId: string) => void) | null>(
    null,
  );

  const clearWatchdog = useCallback(() => {
    if (watchdogRef.current) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
  }, []);

  const scheduleWatchdog = useCallback(
    (requestId: string) => {
      clearWatchdog();
      watchdogRef.current = setTimeout(() => {
        if (requestIdRef.current !== requestId) {
          return;
        }

        if (
          !skipOpenCvRef.current &&
          !autoFallbackAttemptedRef.current &&
          (latestImageSrcRef.current || latestImageBytesRef.current)
        ) {
          autoFallbackAttemptedRef.current = true;
          restartWithoutOpenCvRef.current?.(requestId);
          return;
        }

        if (workerRef.current) {
          workerRef.current.postMessage({
            type: 'cancel',
            requestId,
          });
        }

        setError(
          'OCR timeout: proses terlalu lama meskipun sudah OCR-only fallback. Silakan retry scan.',
        );
        setRunning(false);
        setStage({stage: 'Timed out', progress: 0});
      }, OCR_STALL_TIMEOUT_MS);
    },
    [clearWatchdog],
  );

  const workerUrl = useMemo(() => {
    return `${workerBasePath}/workers/ktp-ocr.worker.js?v=${workerVersion}`;
  }, [workerBasePath, workerVersion]);

  const ensureWorker = useCallback(() => {
    if (workerRef.current) {
      return workerRef.current;
    }

    workerRef.current = new Worker(workerUrl);
    return workerRef.current;
  }, [workerUrl]);

  restartWithoutOpenCvRef.current = stalledRequestId => {
    if (!latestImageSrcRef.current && !latestImageBytesRef.current) {
      return;
    }

    if (requestIdRef.current !== stalledRequestId) {
      return;
    }

    clearWatchdog();
    workerRef.current?.terminate();
    workerRef.current = null;

    const worker = ensureWorker();
    const requestId = createRequestId();
    requestIdRef.current = requestId;
    skipOpenCvRef.current = true;
    scheduleWatchdog(requestId);

    setError('');
    setRunning(true);
    setStage({
      stage: 'OpenCV timeout, switching to OCR-only fallback',
      progress: 18,
    });

    worker.postMessage({
      type: 'scan',
      requestId,
      imageSrc: latestImageSrcRef.current,
      imageBytes: latestImageBytesRef.current
        ? latestImageBytesRef.current.slice(0)
        : undefined,
      imageMimeType: latestFileRef.current?.type || 'image/jpeg',
      debug,
      forceSkipOpenCv: true,
    });
  };

  const run = useCallback(
    async (file: File) => {
      latestFileRef.current = file;
      setError('');
      setResult(null);
      setRunning(true);

      const imageBytes = await file.arrayBuffer();
      const imageSrc = await toDataUrl(file);
      latestImageSrcRef.current = imageSrc;
      latestImageBytesRef.current = imageBytes.slice(0);
      const worker = ensureWorker();
      const requestId = createRequestId();
      requestIdRef.current = requestId;
      skipOpenCvRef.current = false;
      autoFallbackAttemptedRef.current = false;
      scheduleWatchdog(requestId);

      worker.onmessage = event => {
        const payload = event.data;
        if (!payload || payload.requestId !== requestIdRef.current) {
          return;
        }

        if (payload.type === 'progress') {
          scheduleWatchdog(payload.requestId);
          setStage({stage: payload.stage, progress: payload.progress});
          return;
        }

        if (payload.type === 'error') {
          clearWatchdog();
          setError(payload.message || 'OCR failed.');
          setRunning(false);
          return;
        }

        if (payload.type === 'result') {
          clearWatchdog();
          const fields = buildIdentityFields(
            payload.rawText || '',
            payload.nik || '',
          );
          const confidenceEngine = buildConfidenceEngine({
            fields,
            quality: payload.quality,
            ocrConfidence: payload.confidence || 0,
          });

          setResult({
            fields,
            rawText: payload.rawText || '',
            confidence: payload.confidence || 0,
            confidenceEngine,
            quality: payload.quality,
            telemetry: payload.telemetry,
            sourceImageDataUrl: imageSrc,
            previewCropDataUrl:
              payload.debugImages?.finalOcrUsed ||
              payload.debugImages?.finalOcrBinary ||
              payload.debugImages?.finalOcr ||
              payload.debugImages?.candidate ||
              payload.debugImages?.perspective,
          });
          setStage({stage: 'Completed', progress: 100});
          setRunning(false);
        }
      };

      worker.onerror = event => {
        clearWatchdog();
        setError(event.message || 'OCR worker crashed.');
        setRunning(false);
      };

      worker.postMessage(
        {
          type: 'scan',
          requestId,
          imageSrc,
          imageBytes,
          imageMimeType: file.type || 'image/jpeg',
          debug,
          forceSkipOpenCv: false,
        },
        [imageBytes],
      );
    },
    [clearWatchdog, debug, ensureWorker, scheduleWatchdog],
  );

  const cancel = useCallback(() => {
    if (!workerRef.current || !requestIdRef.current) {
      return;
    }

    workerRef.current.postMessage({
      type: 'cancel',
      requestId: requestIdRef.current,
    });

    skipOpenCvRef.current = false;
    autoFallbackAttemptedRef.current = false;
    clearWatchdog();
    setRunning(false);
    setStage({stage: 'Cancelled', progress: 0});
  }, [clearWatchdog]);

  const retry = useCallback(async () => {
    if (!latestFileRef.current) {
      return;
    }

    await run(latestFileRef.current);
  }, [run]);

  useEffect(() => {
    return () => {
      clearWatchdog();
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, [clearWatchdog]);

  return {
    running,
    error,
    stage,
    result,
    run,
    retry,
    cancel,
  };
};
