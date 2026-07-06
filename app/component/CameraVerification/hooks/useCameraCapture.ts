import { useState, useRef, useCallback } from "react";

export type CaptureResult = {
  blob: Blob;
  base64: string;
  width: number;
  height: number;
};

export const useCameraCapture = (videoRef: React.RefObject<HTMLVideoElement>) => {
  const [capturing, setCapturing] = useState(false);
  const [capturedImage, setCapturedImage] = useState<CaptureResult | null>(null);

  const captureImage = useCallback(async (): Promise<CaptureResult | null> => {
    const video = videoRef.current;
    if (!video) return null;

    setCapturing(true);

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setCapturing(false);
      return null;
    }

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg"),
    );

    if (!blob) {
      setCapturing(false);
      return null;
    }

    const base64 = canvas.toDataURL("image/jpeg");
    const result = {
      blob,
      base64,
      width: canvas.width,
      height: canvas.height,
    };

    setCapturedImage(result);
    setCapturing(false);
    return result;
  }, [videoRef]);

  return { captureImage, capturing, capturedImage, setCapturedImage };
};
