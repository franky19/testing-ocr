"use client";
import React, { useRef, useState, useEffect } from "react";
import { X, RotateCw } from "lucide-react";
import { useCameraLifecycle } from "./hooks/useCameraLifecycle";
import { useCameraCapture } from "./hooks/useCameraCapture";
import "./CameraVerification.scss";

interface CameraVerificationProps {
  onClose: () => void;
  onCapture?: (data: any) => void;
}

const CameraVerification: React.FC<CameraVerificationProps> = ({
  onClose,
  onCapture,
}) => {
  const [showPermissionModal, setShowPermissionModal] = useState(true);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const {
    stream,
    loading,
    error,
    facingMode,
    devices,
    startCamera,
    switchCamera,
    stopCamera,
  } = useCameraLifecycle();
  const { captureImage, capturing, capturedImage, setCapturedImage } =
    useCameraCapture(videoRef);

  useEffect(() => {
    if (stream && videoRef.current) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  const handleContinue = async () => {
    setShowPermissionModal(false);
    await startCamera(facingMode);
  };

  const handleCapture = async () => {
    const result = await captureImage();
    if (result) {
      stopCamera();
    }
  };

  const handleRetake = async () => {
    setCapturedImage(null);
    await startCamera(facingMode);
  };

  const handleConfirm = () => {
    if (capturedImage && onCapture) {
      onCapture(capturedImage);
    }
  };

  const handleFlipCamera = async () => {
    await switchCamera();
  };

  return (
    <div className="camera-container">
      {showPermissionModal && (
        <dialog open className="modal-overlay">
          <div className="modal-content">
            <h3>Camera Permission Required</h3>
            <p>
              We need access to your camera to perform biometric verification.
            </p>
            <p>
              Your camera will only be used during this verification process.
            </p>
            <p>No image is captured until the user presses Capture.</p>
            <button onClick={handleContinue}>Continue</button>
            <button onClick={onClose}>Cancel</button>
          </div>
        </dialog>
      )}

      {/* Main Instructions & Framing Area */}
      <div className="camera-content">
        {loading && <p>Loading camera...</p>}
        {error && <p className="error">{error}</p>}
        {!stream &&
          !loading &&
          !error &&
          !showPermissionModal &&
          !capturedImage && (
            <div className="camera-fallback">
              Camera not available or permission denied.
            </div>
          )}
        {stream && (
          <>
            <h2 className="camera-title">
              Position your face in the center of the circle, then take a photo.
            </h2>

            {/* Camera Mask / Circle Cutout */}
            <div className="camera-mask">
              {capturedImage ? (
                <div className="camera-stream">
                  <img
                    src={capturedImage.base64}
                    alt="Captured"
                    className="video-element"
                  />
                </div>
              ) : (
                <div className="camera-stream">
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    className={`video-element ${facingMode === "user" ? "mirrored" : ""}`}
                  />
                  {/* Camera Stream Active */}
                </div>
              )}
            </div>
          </>
        )}
        {capturedImage?.base64 ? (
          <>
            <h2 className="camera-title">Capture images</h2>

            {/* Camera Mask / Circle Cutout */}
            <div className="camera-mask">
              <div className="camera-stream">
                <img
                  src={capturedImage?.base64 || ""}
                  alt="Captured"
                  className="video-element"
                />
              </div>
            </div>
          </>
        ) : null}
      </div>

      {/* Bottom Controls Panel */}
      <div className="camera-controls">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="btn-icon"
          aria-label="Close camera"
          type="button"
        >
          <X className="icon-close" strokeWidth={2} />
        </button>

        {/* Capture/Confirm Controls */}
        {capturedImage ? (
          <>
            <button onClick={handleRetake} className="btn-icon" type="button">
              Retake
            </button>
            <button onClick={handleConfirm} className="btn-icon" type="button">
              Confirm
            </button>
          </>
        ) : (
          <button
            onClick={handleCapture}
            className="btn-shutter"
            aria-label="Take photo"
            type="button"
            disabled={!stream || capturing}
          >
            <div className="btn-shutter-inner" />
          </button>
        )}

        {/* Camera Flip Button */}
        {!capturedImage && devices.length > 1 && (
          <button
            onClick={handleFlipCamera}
            className="btn-icon"
            aria-label="Flip camera"
            type="button"
            disabled={loading || capturing}
          >
            <RotateCw className="icon-flip" strokeWidth={2.5} />
          </button>
        )}
      </div>
    </div>
  );
};

export default CameraVerification;
