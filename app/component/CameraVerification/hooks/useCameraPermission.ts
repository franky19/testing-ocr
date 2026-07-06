import { useState, useCallback, useRef, useEffect } from "react";

export type CameraPermissionState = "granted" | "denied" | "prompt";

export const useCameraPermission = () => {
  const [permissionState, setPermissionState] = useState<CameraPermissionState>("prompt");

  useEffect(() => {
    if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions
        .query({ name: "camera" as PermissionName })
        .then((result) => {
          setPermissionState(result.state);
          result.onchange = () => setPermissionState(result.state);
        });
    }
  }, []);

  return { permissionState };
};
