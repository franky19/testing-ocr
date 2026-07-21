"use client";

import React, { useRef, useState } from "react";
import Image from "next/image";
import { Camera, CameraType } from "react-camera-pro";
import "./CameraVerification.scss";

interface CameraVerificationProps {
  onClose?: () => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onCapture?: (data: any) => void;
  title?: string;
  initialFacingMode?: "user" | "environment";
}

const CameraVerificationV2: React.FC<CameraVerificationProps> = ({
  onClose,
  onCapture,
  title = "Posisikan wajah di tengah lingkaran, lalu ambil foto.",
  initialFacingMode = "user",
}) => {
  // Ref for react-camera-pro
  const cameraRef = useRef<CameraType | null>(null);

  // Component states
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [capturing, setCapturing] = useState<boolean>(false);
  // const [showPermissionModal, setShowPermissionModal] =
  //   useState<boolean>(false);
  // const [cameraError, setCameraError] = useState<string | null>(null);

  // Permission / Continue action
  // const handleContinue = () => {
  //   setShowPermissionModal(false);
  // };

  // 1. TAKE PHOTO
  const handleCapture = () => {
    if (!cameraRef.current) return;

    setCapturing(true);
    try {
      // takePhoto() returns a base64 encoded image string
      const imageBase64 = cameraRef.current.takePhoto();
      if (typeof imageBase64 === "string") {
        setCapturedImage(imageBase64);
      }
    } catch (err) {
      // console.error('Failed to take photo:', err);
    } finally {
      setCapturing(false);
    }
  };

  // 2. RETAKE PHOTO
  const handleRetake = () => {
    setCapturedImage(null);
  };

  // 3. CONFIRM & SUBMIT PHOTO
  const handleConfirm = () => {
    if (capturedImage && onCapture) {
      onCapture(capturedImage);
    }
  };

  // 4. SWITCH/FLIP CAMERA
  const handleFlipCamera = () => {
    if (cameraRef.current) {
      cameraRef.current.switchCamera();
    }
  };

  return (
    <div className="camera-container">
      {/* Permission Modal */}
      {/* <PopupModalSuccess
        setOpenModal={setShowPermissionModal}
        openModal={showPermissionModal}
        description={
          <>
            <h3>“smartfren.com” Ingin Mengakses Kamera</h3>
            <p>Izinkan akses kamera untuk mengambil foto.</p>
            <button onClick={handleContinue}>Continue</button>
            <button onClick={onClose}>Cancel</button>
          </>
        }
      /> */}

      {/* Main Instructions & Framing Area */}
      <div className="camera-content">
        <h2 className="camera-title">{title}</h2>

        {/* {cameraError && <p className="error">{cameraError}</p>} */}

        {/* Camera Mask / Circle Cutout */}
        <div className="camera-mask">
          <div className="camera-stream">
            {capturedImage ? (
              <img
                src={capturedImage}
                alt="Captured Face"
                className="video-element"
              />
            ) : (
              <Camera
                ref={cameraRef}
                facingMode={initialFacingMode}
                aspectRatio={1}
                errorMessages={{
                  noCameraAccessible: "Kamera tidak dapat diakses",
                  permissionDenied: "Izin kamera ditolak",
                  switchCamera: "Gagal mengganti kamera",
                  canvas: "Terjadi kesalahan pada canvas",
                }}
              />
            )}
          </div>
        </div>
      </div>

      {/* Bottom Controls Panel */}
      {capturedImage ? (
        <div className="capture-controls-btn">
          {/* <Buttons
            types="primary"
            sizes="xl"
            label="Lanjutkan"
            stretch
            onClick={handleConfirm}
          /> */}
          <button
            onClick={handleConfirm}
            className="btn-icon"
            type="button"
            style={{ backgroundColor: "white", color: "black" }}
          >
            Confirm
          </button>
          {/* <Buttons
            types="tertiery"
            sizes="xl"
            label="Foto Ulang"
            stretch
            onClick={handleRetake}
          /> */}
          <button
            onClick={handleRetake}
            className="btn-icon"
            type="button"
            style={{ backgroundColor: "white", color: "black" }}
          >
            Retake
          </button>
          <button
            onClick={handleRetake}
            className="btn-icon"
            type="button"
            style={{ backgroundColor: "white", color: "black" }}
          >
            Kembali
          </button>
          {/* <Buttons
            types=""
            sizes="xl"
            label="Kembali"
            stretch
            onClick={onClose}
            styles={{ backgroundColor: "transparent", color: "#FFFFFF" }}
          /> */}
        </div>
      ) : (
        <div className="camera-controls">
          {/* Close Button */}
          <button
            onClick={onClose}
            className="btn-icon"
            aria-label="Close camera"
            type="button"
          >
            <Image
              src="https://ucms-api.smartfren.com/ucms/api/v1/uploads/Close_Button_ab1a6b668d.png"
              width={44}
              height={44}
              alt="close-icon"
            />
          </button>

          {/* Shutter / Capture Button */}
          <button
            onClick={handleCapture}
            className="btn-shutter"
            aria-label="Take photo"
            type="button"
            disabled={capturing}
          />

          {/* Camera Flip Button */}
          <button
            onClick={handleFlipCamera}
            className="btn-icon"
            aria-label="Flip camera"
            type="button"
            disabled={capturing}
          >
            <Image
              src="https://ucms-api.smartfren.com/ucms/api/v1/uploads/Shutter_Button_9c6e4973ce.png"
              width={44}
              height={44}
              alt="flip-camera-icon"
            />
          </button>
        </div>
      )}
    </div>
  );
};

export default CameraVerificationV2;
