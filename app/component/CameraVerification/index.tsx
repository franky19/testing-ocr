'use client'
import React, { useState } from "react";
import { X, RotateCw } from "lucide-react";
import "./CameraVerification.scss";

interface CameraVerificationProps {
  onClose: () => void;
  onCapture?: () => void;
}

const CameraVerification: React.FC<CameraVerificationProps> = ({
  onClose,
  onCapture,
}) => {
  const [isCameraReady] = useState<boolean>(true); // Simulating camera state

  const handleCapture = (): void => {
    if (onCapture) {
      onCapture();
    }
    console.log("Photo captured!");
  };

  const handleFlipCamera = (): void => {
    console.log("Flipping camera view...");
  };

  return (
    <div className="camera-container">
      {/* Top Overlay / Status Bar Area Placeholder */}
      <div className="camera-top-bar" />

      {/* Main Instructions & Framing Area */}
      <div className="camera-content">
        <h2 className="camera-title">
          Position your face in the center of the circle, then take a photo.
        </h2>

        {/* Camera Mask / Circle Cutout */}
        <div className="camera-mask">
          {isCameraReady ? (
            <div className="camera-stream">
              {/* <video ref={videoRef} autoPlay playsInline className="video-element" /> */}
              Camera Stream Active
            </div>
          ) : (
            <div className="camera-fallback" />
          )}
        </div>
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

        {/* Capture Shutter Button */}
        <button
          onClick={handleCapture}
          className="btn-shutter"
          aria-label="Take photo"
          type="button"
        >
          <div className="btn-shutter-inner" />
        </button>

        {/* Camera Flip Button */}
        <button
          onClick={handleFlipCamera}
          className="btn-icon"
          aria-label="Flip camera"
          type="button"
        >
          <RotateCw className="icon-flip" strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
};

export default CameraVerification;
