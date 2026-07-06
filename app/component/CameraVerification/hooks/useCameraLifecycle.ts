import { useState, useCallback, useEffect, useRef } from "react";

export type CameraDevice = {
  deviceId: string;
  label: string;
};

export const useCameraLifecycle = () => {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");
  const [devices, setDevices] = useState<CameraDevice[]>([]);

  const cleanupStream = useCallback(() => {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      setStream(null);
    }
  }, [stream]);

  const startCamera = useCallback(async (mode: "user" | "environment" = "user") => {
    cleanupStream();
    setLoading(true);
    setError(null);
    try {
      const constraints: MediaStreamConstraints = {
        video: { facingMode: { exact: mode } },
      };
      const newStream = await navigator.mediaDevices.getUserMedia(constraints);
      setStream(newStream);
      setFacingMode(mode);
    } catch (err: any) {
      setError(err.message || "Failed to start camera");
    } finally {
      setLoading(false);
    }
  }, [cleanupStream]);

  const switchCamera = useCallback(async () => {
    const nextMode = facingMode === "user" ? "environment" : "user";
    await startCamera(nextMode);
  }, [facingMode, startCamera]);

  useEffect(() => {
    navigator.mediaDevices.enumerateDevices().then((deviceInfos) => {
      const videoDevices = deviceInfos
        .filter((d) => d.kind === "videoinput")
        .map((d) => ({ deviceId: d.deviceId, label: d.label }));
      setDevices(videoDevices);
    });
  }, []);

  useEffect(() => {
    return () => cleanupStream();
  }, [cleanupStream]);

  return { stream, loading, error, facingMode, devices, startCamera, stopCamera: cleanupStream, switchCamera };
};
