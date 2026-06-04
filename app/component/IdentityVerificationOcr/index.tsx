"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Webcam from "react-webcam";
import { BoundingBox, CameraDebugData } from "./interface/ICamera";
import useDataOcr from "./useDataOcr";
import {
  KTPData,
  NikOcrPass,
  NikOcrPassResult,
} from "./interface/IIdentityOcr";
import { MDNData, MdnPreprocessPipeline } from "./interface/IMdnOcr";
import { createIdentityOcrHelpers } from "./ocrHelpers";
import { buildCameraNikPipeline } from "./cameraNikPipeline";

type NikStageTiming = {
  stage: string;
  ms: number;
};

const nowMs = () => {
  return globalThis.performance?.now() ?? Date.now();
};

const extractNikCandidates16 = (text: string) => {
  const digits = text.replace(/\D/g, "");
  const candidates: string[] = [];

  if (digits.length < 16) {
    return candidates;
  }

  for (let index = 0; index <= digits.length - 16; index += 1) {
    const candidate = digits.slice(index, index + 16);

    if (/^\d{16}$/.test(candidate)) {
      candidates.push(candidate);
    }
  }

  return Array.from(new Set(candidates));
};

const normalizeNikConfidence = (
  bestPassConfidence: number,
  supportCount: number,
  totalPasses: number,
) => {
  const boundedBest = Math.max(0, Math.min(100, bestPassConfidence));
  const boundedPassCount = Math.max(1, totalPasses);
  let agreementRatio = supportCount / boundedPassCount;
  agreementRatio = Math.max(0, Math.min(1, agreementRatio));

  if (agreementRatio >= 0.99 && boundedBest >= 35) {
    return 100;
  }

  const blended = boundedBest * 0.7 + agreementRatio * 100 * 0.3;
  let bonus = 0;

  if (agreementRatio >= 0.67) {
    bonus = 8;
  } else if (agreementRatio >= 0.5) {
    bonus = 4;
  }

  return Math.max(0, Math.min(100, blended + bonus));
};

/**
 * Remove background from a camera-captured image using Canvas API.
 * Uses brightness thresholding, adaptive threshold, erosion, and dilation.
 * Returns white-background image suitable for OCR + a confidence score.
 */
const removeBackgroundFromCapture = (
  imageSrc: string,
): Promise<{ dataUrl: string; confidence: number }> => {
  return new Promise((resolve) => {
    const img = new Image();

    img.onload = async () => {
      try {
        const { naturalWidth: width, naturalHeight: height } = img;

        let canvasEl: HTMLCanvasElement | null = null;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let offscreenEl: any = null;

        if ((globalThis as any).OffscreenCanvas !== undefined) {
          offscreenEl = new (globalThis as any).OffscreenCanvas(width, height);
        } else {
          canvasEl = document.createElement("canvas");
          canvasEl.width = width;
          canvasEl.height = height;
        }

        const ctx: CanvasRenderingContext2D | null = offscreenEl
          ? offscreenEl.getContext("2d")
          : canvasEl?.getContext("2d") ?? null;

        if (!ctx) {
          resolve({ dataUrl: imageSrc, confidence: 0 });
          return;
        }

        ctx.drawImage(img, 0, 0);

        const yieldFrame = () =>
          new Promise<void>((r) => {
            if (typeof requestAnimationFrame === "undefined") {
              setTimeout(r, 0);
            } else {
              requestAnimationFrame(() => r());
            }
          });

        await yieldFrame();

        const imageData = ctx.getImageData(0, 0, width, height);
        const data = imageData.data;
        const totalPixels = width * height;

        // Count original dark pixels (text, borders, card content)
        let originalDarkPixels = 0;

        for (let i = 0; i < data.length; i += 4) {
          const brightness =
            data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;

          if (brightness <= 180) {
            originalDarkPixels += 1;
          }
        }

        await yieldFrame();

        // Step 1: Brightness threshold — pixels brighter than 220 are background
        const mask = new Uint8Array(totalPixels);

        for (let i = 0; i < totalPixels; i += 1) {
          const d = i * 4;
          const brightness =
            data[d] * 0.299 + data[d + 1] * 0.587 + data[d + 2] * 0.114;

          mask[i] = brightness <= 220 ? 1 : 0;
        }

        await yieldFrame();

        // Step 2: Adaptive threshold — remove pixels brighter than local mean + 15
        const adaptedMask = new Uint8Array(mask);
        const ADAPTIVE_R = 3;

        for (let y = 0; y < height; y += 1) {
          for (let x = 0; x < width; x += 1) {
            const pi = y * width + x;

            if (mask[pi] === 0) continue;

            let sum = 0;
            let count = 0;

            for (let dy = -ADAPTIVE_R; dy <= ADAPTIVE_R; dy += 1) {
              for (let dx = -ADAPTIVE_R; dx <= ADAPTIVE_R; dx += 1) {
                const nx = x + dx;
                const ny = y + dy;

                if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                  const ni = (ny * width + nx) * 4;

                  sum +=
                    data[ni] * 0.299 +
                    data[ni + 1] * 0.587 +
                    data[ni + 2] * 0.114;
                  count += 1;
                }
              }
            }

            const localMean = sum / count;
            const di = pi * 4;
            const brightness =
              data[di] * 0.299 + data[di + 1] * 0.587 + data[di + 2] * 0.114;

            if (brightness > localMean + 15 && brightness > 180) {
              adaptedMask[pi] = 0;
            }
          }
        }

        await yieldFrame();

        // Step 3: Erosion — remove isolated noise pixels
        const MORPH_R = 1;
        const erodedMask = new Uint8Array(adaptedMask);

        for (let y = 0; y < height; y += 1) {
          for (let x = 0; x < width; x += 1) {
            const pi = y * width + x;

            if (adaptedMask[pi] === 0) continue;

            let solid = 0;
            let total = 0;

            for (let dy = -MORPH_R; dy <= MORPH_R; dy += 1) {
              for (let dx = -MORPH_R; dx <= MORPH_R; dx += 1) {
                if (dx === 0 && dy === 0) continue;

                const nx = x + dx;
                const ny = y + dy;

                if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                  solid += adaptedMask[ny * width + nx];
                  total += 1;
                }
              }
            }

            if (total > 0 && solid / total < 0.25) {
              erodedMask[pi] = 0;
            }
          }
        }

        await yieldFrame();

        // Step 4: Dilation — fill small gaps in preserved regions
        const dilatedMask = new Uint8Array(erodedMask);

        for (let y = 0; y < height; y += 1) {
          for (let x = 0; x < width; x += 1) {
            const pi = y * width + x;

            if (erodedMask[pi] === 1) continue;

            let solid = 0;
            let total = 0;

            for (let dy = -MORPH_R; dy <= MORPH_R; dy += 1) {
              for (let dx = -MORPH_R; dx <= MORPH_R; dx += 1) {
                if (dx === 0 && dy === 0) continue;

                const nx = x + dx;
                const ny = y + dy;

                if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                  solid += erodedMask[ny * width + nx];
                  total += 1;
                }
              }
            }

            if (total > 0 && solid / total > 0.65) {
              dilatedMask[pi] = 1;
            }
          }
        }

        await yieldFrame();

        // Apply mask — set background pixels to white, count preserved dark pixels
        let preservedDarkPixels = 0;

        for (let pi = 0; pi < totalPixels; pi += 1) {
          const di = pi * 4;

          if (dilatedMask[pi] === 0) {
            data[di] = 255;
            data[di + 1] = 255;
            data[di + 2] = 255;
            data[di + 3] = 255;
          } else {
            const brightness =
              data[di] * 0.299 + data[di + 1] * 0.587 + data[di + 2] * 0.114;

            if (brightness <= 180) {
              preservedDarkPixels += 1;
            }
          }
        }

        ctx.putImageData(imageData, 0, 0);

        // Confidence: how many original dark pixels (text/content) were preserved
        const confidence =
          originalDarkPixels > 0
            ? Math.min(
                100,
                (preservedDarkPixels / originalDarkPixels) * 100,
              )
            : 0;

        if (offscreenEl) {
          const blob = await offscreenEl.convertToBlob({ type: "image/png" });
          const reader = new FileReader();

          reader.onload = () => {
            resolve({ dataUrl: reader.result as string, confidence });
          };

          reader.onerror = () => {
            resolve({ dataUrl: imageSrc, confidence: 0 });
          };

          reader.readAsDataURL(blob);
        } else if (canvasEl) {
          resolve({
            dataUrl: canvasEl.toDataURL("image/png"),
            confidence,
          });
        } else {
          resolve({ dataUrl: imageSrc, confidence: 0 });
        }
      } catch {
        resolve({ dataUrl: imageSrc, confidence: 0 });
      }
    };

    img.onerror = () => {
      resolve({ dataUrl: imageSrc, confidence: 0 });
    };

    img.src = imageSrc;
  });
};

export const IdentityVerification = () => {
  const webcamRef = useRef<Webcam | null>(null);

  const webcamContainerRef = useRef<HTMLDivElement | null>(null);

  const [image, setImage] = useState("");

  const [loading, setLoading] = useState(false);

  const [progress, setProgress] = useState(0);
  const [ocrStatus, setOcrStatus] = useState("");

  const [rawText, setRawText] = useState("");
  const [cameraReady, setCameraReady] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [visualVerificationMode, setVisualVerificationMode] = useState(false);
  const [cameraDebugData, setCameraDebugData] =
    useState<CameraDebugData | null>(null);

  /**
   * FULL PROCESSED IMAGE
   */

  const [fullProcessedImage, setFullProcessedImage] = useState("");

  /**
   * BACKGROUND REMOVED IMAGE (camera capture only)
   */

  const [backgroundRemovedImage, setBackgroundRemovedImage] = useState("");

  const [bgRemovalConfidence, setBgRemovalConfidence] = useState(0);

  /**
   * CROPPED FIELD IMAGES
   */

  const [processedFields, setProcessedFields] = useState<
    Record<string, string>
  >({});

  const [ktpData, setKtpData] = useState<KTPData>({
    nik: "",
    nama: "",
    tempatLahir: "",
    tanggalLahir: "",
    jenisKelamin: "",
    alamat: "",
    agama: "",
    status: "",
  });

  const [nikData, setNikData] = useState<{
    nik: string;
    confidence: number;
    rawCandidates: string[];
  }>({
    nik: "",
    confidence: 0,
    rawCandidates: [],
  });

  const [nikDebugText, setNikDebugText] = useState("");
  const [processedFieldConfidence, setProcessedFieldConfidence] = useState<
    Record<string, number>
  >({});

  const [mdnData, setMdnData] = useState<MDNData>({
    mdn: "",
    confidence: 0,
    rawCandidates: [],
  });

  const [mdnDebugText, setMdnDebugText] = useState("");
  const [activeCaptureOverlay, setActiveCaptureOverlay] = useState<
    "nik" | "mdn"
  >("nik");

  const {
    videoConstraints,
    WEBCAM_PREVIEW_WIDTH,
    WEBCAM_ASPECT_RATIO,
    NIK_CHAR_MAP,
    NIK_OCR_WHITELIST,
    MDN_OCR_WHITELIST,
    MDN_CHAR_CORRECTION_MAP,
    NIK_DYNAMIC_SCALE_HEIGHT_THRESHOLD,
    MDN_PRIMARY_REGION,
    MDN_FALLBACK_REGION,
    MDN_SCAN_PRIORITY_REGIONS,
    NIK_DIGIT_CORRECTION_MAP,
    FIELD_AREAS,
    getNikOverlayArea,
    getMdnOverlayArea,
    getCropAreaFromOverlay,
    visualizeCropArea,
  } = useDataOcr();

  useEffect(() => {
    const syncViewportWidth = () => {
      setViewportWidth(globalThis.innerWidth);
    };

    syncViewportWidth();

    globalThis.addEventListener("resize", syncViewportWidth);
    globalThis.addEventListener("orientationchange", syncViewportWidth);

    return () => {
      globalThis.removeEventListener("resize", syncViewportWidth);
      globalThis.removeEventListener("orientationchange", syncViewportWidth);
    };
  }, []);

  const nikOverlayArea = useMemo(() => {
    return getNikOverlayArea(viewportWidth);
  }, [getNikOverlayArea, viewportWidth]);

  const mdnOverlayArea = useMemo(() => {
    return getMdnOverlayArea(viewportWidth);
  }, [getMdnOverlayArea, viewportWidth]);

  const activeOverlayArea = useMemo(() => {
    return activeCaptureOverlay === "mdn" ? mdnOverlayArea : nikOverlayArea;
  }, [activeCaptureOverlay, mdnOverlayArea, nikOverlayArea]);

  const {
    preprocessFullImage,
    cropField,
    recognizeText,
    cleanText,
    extractNik,
    mapNikLikeCharsToDigits,
    recognizeNikPass,
    extractMDN,
    isValidMdn,
    yieldMainThread,
    buildMdnRegionProposals,
    buildMdnPreprocessPipeline,
    runMdnPassGroup,
    captureOverlayFrame,
    resolveBestMdnCandidate,
  } = createIdentityOcrHelpers({
    setProgress,
    setOcrStatus,
    NIK_CHAR_MAP,
    NIK_OCR_WHITELIST,
    MDN_OCR_WHITELIST,
    MDN_CHAR_CORRECTION_MAP,
    NIK_DYNAMIC_SCALE_HEIGHT_THRESHOLD,
    MDN_PRIMARY_REGION,
    NIK_DIGIT_CORRECTION_MAP,
    getCropAreaFromOverlay,
    visualizeCropArea,
  });

  /**
   * MAIN OCR
   */

  const runOCR = async (imageSrc: string) => {
    try {
      setLoading(true);

      setBackgroundRemovedImage("");
      setBgRemovalConfidence(0);

      setProgress(0);
      setOcrStatus("Preprocessing KTP image");

      /**
       * preprocess full image
       */

      const fullProcessed = await preprocessFullImage(imageSrc);

      setFullProcessedImage(fullProcessed);

      setOcrStatus("Cropping OCR fields");

      /**
       * crop all fields
       */

      const nikCrop = await cropField(imageSrc, FIELD_AREAS.nik);

      const namaCrop = await cropField(imageSrc, FIELD_AREAS.nama);

      const ttlCrop = await cropField(imageSrc, FIELD_AREAS.ttl);

      const genderCrop = await cropField(imageSrc, FIELD_AREAS.gender);

      const alamatCrop = await cropField(imageSrc, FIELD_AREAS.alamat);

      const agamaCrop = await cropField(imageSrc, FIELD_AREAS.agama);

      const statusCrop = await cropField(imageSrc, FIELD_AREAS.status);

      /**
       * set crop preview
       */

      setProcessedFields({
        nik: nikCrop,
        nama: namaCrop,
        ttl: ttlCrop,
        gender: genderCrop,
        alamat: alamatCrop,
        agama: agamaCrop,
        status: statusCrop,
      });
      setProcessedFieldConfidence({});

      /**
       * OCR per field
       */

      /**
       * OCR PER FIELD SEQUENTIAL
       */

      setOcrStatus("Reading NIK");
      setProgress(5);

      const nikText = await recognizeText(nikCrop, "eng", "0123456789", "7");

      setOcrStatus("Reading Name");
      setProgress(20);

      const namaText = await recognizeText(
        namaCrop,
        "ind",
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz ",
        "6",
      );

      setOcrStatus("Reading Birth Information");
      setProgress(35);

      const ttlText = await recognizeText(
        ttlCrop,
        "ind",
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789,./- ",
        "7",
      );

      setOcrStatus("Reading Gender");
      setProgress(50);

      const genderText = await recognizeText(
        genderCrop,
        "ind",
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz- ",
        "7",
      );

      setOcrStatus("Reading Address");
      setProgress(65);

      const alamatText = await recognizeText(
        alamatCrop,
        "ind",
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789./- ",
        "6",
      );

      setOcrStatus("Reading Religion");
      setProgress(80);

      const agamaText = await recognizeText(
        agamaCrop,
        "ind",
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz ",
        "7",
      );

      setOcrStatus("Reading Marital Status");
      setProgress(90);

      const statusText = await recognizeText(
        statusCrop,
        "ind",
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz ",
        "7",
      );

      setProgress(100);

      setOcrStatus("Parsing OCR result");

      /**
       * CLEAN RESULT
       */

      const nik = extractNik(nikText);

      const nama = cleanText(namaText)
        .replace(/[^A-Za-z\s]/g, "")
        .toUpperCase();

      /**
       * TTL
       */

      let tempatLahir = "";

      let tanggalLahir = "";

      const ttlMatch = /([A-Z\s]+),?\s*(\d{2}[-/]\d{2}[-/]\d{4})/i.exec(
        ttlText,
      );

      if (ttlMatch) {
        tempatLahir = cleanText(ttlMatch[1]);

        tanggalLahir = cleanText(ttlMatch[2]);
      }

      /**
       * GENDER
       */

      let jenisKelamin = "";

      if (/PEREMPUAN/i.test(genderText)) {
        jenisKelamin = "PEREMPUAN";
      } else if (/LAKI/i.test(genderText)) {
        jenisKelamin = "LAKI-LAKI";
      }

      /**
       * AGAMA
       */

      const agama =
        /ISLAM|KRISTEN|KATOLIK|HINDU|BUDDHA|KHONGHUCU/i.exec(agamaText)?.[0] ||
        "";

      /**
       * STATUS
       */

      let status = "";

      if (/BELUM/i.test(statusText)) {
        status = "BELUM KAWIN";
      } else if (/KAWIN/i.test(statusText)) {
        status = "KAWIN";
      }

      setKtpData({
        nik,

        nama,

        tempatLahir,

        tanggalLahir,

        jenisKelamin,

        alamat: cleanText(alamatText),

        agama,

        status,
      });

      /**
       * RAW TEXT
       */

      setRawText(`
  === NIK ===
  ${nikText}

  === NAMA ===
  ${namaText}

  === TTL ===
  ${ttlText}

  === GENDER ===
  ${genderText}

  === ALAMAT ===
  ${alamatText}

  === AGAMA ===
  ${agamaText}

  === STATUS ===
  ${statusText}
  `);

      setOcrStatus("Completed");
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const runNikOCR = async (nikImageSrc: string) => {
    try {
      setLoading(true);
      const nikStageTimings: NikStageTiming[] = [];
      const recordStageTime = (stage: string, startMs: number) => {
        nikStageTimings.push({
          stage,
          ms: nowMs() - startMs,
        });
      };

      setProcessedFieldConfidence({});
      setNikData({
        nik: "",
        confidence: 0,
        rawCandidates: [],
      });
      setNikDebugText("");

      setOcrStatus("Preparing camera NIK pipeline");
      setProgress(10);

      let stageStart = nowMs();
      const cameraPipeline = await buildCameraNikPipeline(
        nikImageSrc,
        yieldMainThread,
      );
      recordStageTime("nik_camera_pipeline_total", stageStart);

      setProgress(52);

      setProcessedFields({
        nik_source: cameraPipeline.source,
        nik_grayscale: cameraPipeline.grayscale,
        nik_adaptive: cameraPipeline.adaptive,
        nik_morphology: cameraPipeline.digitBand,
        nik_clean_bw: cameraPipeline.sharpened,
      });

      const passes: NikOcrPass[] = [
        {
          label: "camera_sharp_psm7",
          image: cameraPipeline.sharpened,
          psm: "7",
          weight: 1.25,
        },
        {
          label: "camera_sharp_psm8",
          image: cameraPipeline.sharpened,
          psm: "8",
          weight: 1.1,
        },
        {
          label: "camera_sharp_psm13",
          image: cameraPipeline.sharpened,
          psm: "13",
          weight: 1.35,
        },
        {
          label: "camera_band_psm7",
          image: cameraPipeline.digitBand,
          psm: "7",
          weight: 1.15,
        },
        {
          label: "camera_band_psm13",
          image: cameraPipeline.digitBand,
          psm: "13",
          weight: 1.2,
        },
        {
          label: "camera_adaptive_psm8",
          image: cameraPipeline.adaptive,
          psm: "8",
          weight: 0.95,
        },
      ];

      const ocrResults: NikOcrPassResult[] = [];

      for (let index = 0; index < passes.length; index += 1) {
        const pass = passes[index];
        const passTitle =
          `Running OCR pass ${index + 1}/${passes.length} - ` +
          `${pass.label} (psm ${pass.psm})`;
        setOcrStatus(passTitle);
        setProgress(58 + Math.round(((index + 1) / passes.length) * 24));
        stageStart = nowMs();
        const passResult = await recognizeNikPass(pass);
        recordStageTime(`nik_pass_${index + 1}_${pass.label}`, stageStart);
        ocrResults.push(passResult);
      }

      setOcrStatus("Comparing OCR candidates");
      setProgress(86);
      await yieldMainThread();
      stageStart = nowMs();
      const candidateMap: Record<
        string,
        {
          count: number;
          bestConfidence: number;
          weightedScore: number;
        }
      > = {};

      const passRows = ocrResults.map((pass) => {
        const mapped = mapNikLikeCharsToDigits(pass.text);
        const directCandidates = extractNikCandidates16(mapped);
        const extractedByHelper = extractNikCandidates16(
          mapNikLikeCharsToDigits(extractNik(pass.text)),
        );
        const candidates = Array.from(
          new Set([...directCandidates, ...extractedByHelper]),
        );

        candidates.forEach((candidate) => {
          if (!candidateMap[candidate]) {
            candidateMap[candidate] = {
              count: 0,
              bestConfidence: 0,
              weightedScore: 0,
            };
          }

          candidateMap[candidate].count += 1;
          candidateMap[candidate].bestConfidence = Math.max(
            candidateMap[candidate].bestConfidence,
            pass.confidence,
          );
          candidateMap[candidate].weightedScore += pass.weight;
        });

        return {
          label: pass.label,
          confidence: pass.confidence,
          text: pass.text,
          mapped,
          candidates,
        };
      });

      const sortedCandidates = Object.entries(candidateMap)
        .map(([candidate, stat]) => {
          return {
            candidate,
            count: stat.count,
            bestConfidence: stat.bestConfidence,
            weightedScore: stat.weightedScore,
          };
        })
        .filter((entry) => /^\d{16}$/.test(entry.candidate))
        .sort((left, right) => {
          if (right.count !== left.count) {
            return right.count - left.count;
          }

          if (right.weightedScore !== left.weightedScore) {
            return right.weightedScore - left.weightedScore;
          }

          if (right.bestConfidence !== left.bestConfidence) {
            return right.bestConfidence - left.bestConfidence;
          }

          return left.candidate.localeCompare(right.candidate);
        });

      const selected = sortedCandidates[0];
      const selectedCandidate = selected?.candidate || "";
      const selectedConfidence = normalizeNikConfidence(
        selected?.bestConfidence || 0,
        selected?.count || 0,
        passes.length,
      );
      recordStageTime("nik_vote_select", stageStart);

      const consensusThreshold = Math.max(2, Math.ceil(passes.length * 0.5));
      const hasConsensus = (selected?.count || 0) >= consensusThreshold;

      const finalNik =
        selectedConfidence >= 50 || (hasConsensus && selectedConfidence >= 42)
          ? selectedCandidate
          : "";
      const finalStatus = finalNik
        ? "Completed"
        : "Capture ulang. NIK tidak cukup jelas.";

      const confidenceByField: Record<string, number> = {
        nik_grayscale: ocrResults[0]?.confidence || 0,
        nik_adaptive: ocrResults[1]?.confidence || 0,
        nik_morphology: ocrResults[2]?.confidence || 0,
        nik_clean_bw: selectedConfidence,
      };

      setProcessedFieldConfidence(confidenceByField);

      const nikRawText = passRows
        .map((pass) => {
          return `${pass.label} (conf=${pass.confidence.toFixed(1)}): ${
            pass.text
          } | mapped=${pass.mapped} | candidates=${
            pass.candidates.join(", ") || "-"
          }`;
        })
        .join("\n");

      setOcrStatus("Selecting best NIK");
      setProgress(96);

      setFullProcessedImage("");

      setKtpData({
        nik: finalNik,
        nama: "",
        tempatLahir: "",
        tanggalLahir: "",
        jenisKelamin: "",
        alamat: "",
        agama: "",
        status: "",
      });

      setNikData({
        nik: selectedCandidate,
        confidence: selectedConfidence,
        rawCandidates: sortedCandidates.map((entry) => entry.candidate),
      });

      const nikPassesText = passRows
        .map((pass) => {
          return `${pass.label}\ncandidates=${
            pass.candidates.join(", ") || "-"
          }\nconfidence=${pass.confidence.toFixed(2)}`;
        })
        .join("\n\n");

      const nikStageTimingText = nikStageTimings
        .map((timing) => {
          return `${timing.stage}=${timing.ms.toFixed(2)}ms`;
        })
        .join("\n");

      setNikDebugText(`
OCR PASSES

${nikPassesText || "-"}

Captured Resolution

    ${cameraPipeline.metrics.capturedResolution}

Digit Height

    ${cameraPipeline.metrics.digitHeight || 0}

Noise Removed

    ${cameraPipeline.metrics.noiseRemoved}

OCR CONFIDENCE

${selectedConfidence > 0 ? selectedConfidence.toFixed(2) : "-"}

STAGE TIMINGS (ms)

${nikStageTimingText || "-"}

NORMALIZED NIK

${sortedCandidates.map((entry) => entry.candidate).join("\n") || "-"}

Final Candidate

${finalNik || "-"}
`);

      setRawText(`
  === NIK ===
      OCR PASSES:
      ${nikRawText}

      Captured Resolution:
      ${cameraPipeline.metrics.capturedResolution}

      Digit Height:
      ${cameraPipeline.metrics.digitHeight || 0}

      Noise Removed:
      ${cameraPipeline.metrics.noiseRemoved}

      OCR Confidence:
      ${selectedConfidence.toFixed(2)}

      NORMALIZED CANDIDATES:
      ${sortedCandidates.map((entry) => entry.candidate).join("\n") || "-"}

      SELECTED:
      ${finalNik || "-"}
  `);

      setProgress(100);
      setOcrStatus(finalStatus);
    } catch (err) {
      const errorText = err instanceof Error ? err.message : "Unknown error";

      setNikData({
        nik: "",
        confidence: 0,
        rawCandidates: [],
      });

      setNikDebugText(`
OCR PASSES
-

OCR CONFIDENCE
-

NORMALIZED NIK
-

SELECTED NIK
-
`);
      setProcessedFieldConfidence({});
      setOcrStatus("Failed to process NIK");
      setRawText(
        `
=== NIK OCR PASSES ===
-

=== CANDIDATES ===
-

=== SELECTED ===
-

ERROR:
${errorText}
`,
      );
    } finally {
      setLoading(false);
    }
  };

  const runMdnOCR = async (imageSrc: string) => {
    try {
      setLoading(true);
      setProgress(0);

      const scanQueue = [
        ...MDN_SCAN_PRIORITY_REGIONS,
        {
          label: "primary",
          area: MDN_PRIMARY_REGION,
        },
        {
          label: "fallback",
          area: MDN_FALLBACK_REGION,
        },
      ];

      const attempts: Array<{
        result: ReturnType<typeof resolveBestMdnCandidate>;
        pipeline: MdnPreprocessPipeline;
        label: string;
      }> = [];

      for (let scanIndex = 0; scanIndex < scanQueue.length; scanIndex += 1) {
        const scanRegion = scanQueue[scanIndex];

        const regionProgress =
          5 + Math.floor((scanIndex / scanQueue.length) * 70);
        setProgress(regionProgress);

        const proposals = buildMdnRegionProposals(scanRegion.area);

        for (
          let proposalIndex = 0;
          proposalIndex < proposals.length;
          proposalIndex += 1
        ) {
          const proposalArea = proposals[proposalIndex];

          setOcrStatus(
            `Preparing MDN region ${scanRegion.label} p${proposalIndex + 1}`,
          );

          const pipeline = await buildMdnPreprocessPipeline(
            imageSrc,
            proposalArea,
            `${scanRegion.label}_p${proposalIndex + 1}`,
          );

          const attempt = await runMdnPassGroup(
            pipeline,
            `${scanRegion.label}_p${proposalIndex + 1}`,
          );

          attempts.push({
            result: attempt.resolved,
            pipeline: attempt.pipeline,
            label: `${scanRegion.label}_p${proposalIndex + 1}`,
          });

          if (isValidMdn(attempt.resolved.mdn)) {
            break;
          }

          await yieldMainThread();
        }

        const hasValidAtCurrentPriority = attempts.some((attempt) =>
          isValidMdn(attempt.result.mdn),
        );

        if (hasValidAtCurrentPriority && scanRegion.label !== "full") {
          break;
        }

        await yieldMainThread();
      }

      if (attempts.length === 0) {
        throw new Error("MDN OCR did not produce any OCR attempt");
      }

      const sortedAttempts = attempts.toSorted((left, right) => {
        const leftValid = isValidMdn(left.result.mdn) ? 1 : 0;
        const rightValid = isValidMdn(right.result.mdn) ? 1 : 0;

        if (rightValid !== leftValid) return rightValid - leftValid;

        return right.result.confidence - left.result.confidence;
      });

      const bestAttempt = sortedAttempts[0];

      setProcessedFields({
        mdn_source: bestAttempt.pipeline.source,
        mdn_grayscale: bestAttempt.pipeline.grayscale,
        mdn_adaptive: bestAttempt.pipeline.adaptive,
        mdn_morphology: bestAttempt.pipeline.morphology,
        mdn_sharpen: bestAttempt.pipeline.sharpen,
      });
      setProcessedFieldConfidence({});

      setProgress(100);
      setOcrStatus("Selecting best MDN");

      setMdnData({
        mdn: bestAttempt.result.mdn,
        confidence: bestAttempt.result.confidence,
        rawCandidates: bestAttempt.result.uniqueCandidates,
      });

      const mdnPassesText = bestAttempt.result.enrichedPasses
        .filter((pass) => Boolean(pass.text))
        .map((pass) => {
          const normalizedCandidates = extractMDN(pass.text).join(", ") || "-";
          const confidenceText = pass.confidence.toFixed(1);

          return `${pass.label} (conf=${confidenceText}): ${pass.text} | normalized=${normalizedCandidates}`;
        })
        .join("\n");

      const debugText = `
OCR PASSES:
${mdnPassesText || "-"}

OCR CONFIDENCE:
${bestAttempt.result.confidence.toFixed(2)}

NORMALIZED MDN:
${bestAttempt.result.uniqueCandidates.join("\n") || "-"}

SELECTED MDN:
${bestAttempt.result.mdn || "-"}
`;

      setMdnDebugText(debugText);

      setRawText(`
=== MDN OCR PASSES ===
${mdnPassesText || "-"}

=== CANDIDATES ===
${bestAttempt.result.uniqueCandidates.join("\n") || "-"}

=== SELECTED ===
${bestAttempt.result.mdn || "-"}
`);

      setOcrStatus("Completed");
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err);

      setMdnData({
        mdn: "",
        confidence: 0,
        rawCandidates: [],
      });

      setMdnDebugText("");

      setOcrStatus("Failed to process MDN");

      setRawText(
        `
=== MDN OCR PASSES ===
-

=== CANDIDATES ===
-

=== SELECTED ===
-

ERROR:
${err instanceof Error ? err.message : "Unknown error"}
`,
      );
    } finally {
      setLoading(false);
    }
  };

  /**
   * CAMERA CAPTURE
   */

  const capture = async () => {
    if (!webcamRef.current) return;

    const video = webcamRef.current.video;

    if (!video) return;

    const containerElement = webcamContainerRef.current;

    if (!containerElement) return;

    /**
     * Create overlay box with normalized coordinates (0-1)
     * This matches the green overlay border shown on preview
     */

    const overlayBox: BoundingBox = {
      x: nikOverlayArea.x,
      y: nikOverlayArea.y,
      width: nikOverlayArea.width,
      height: nikOverlayArea.height,
    };

    setOcrStatus("Capturing camera frame");
    setProgress(2);

    setOcrStatus("Locating NIK region");
    setProgress(6);

    /**
     * Get precise crop area accounting for object-fit: cover
     */

    const capturedFrame = captureOverlayFrame(
      video,
      containerElement,
      overlayBox,
    );

    if (!capturedFrame) return;

    const { imageSrc, cameraDebugData: debugData } = capturedFrame;

    setCameraDebugData(debugData);

    setImage(imageSrc);

    setOcrStatus("Removing background");
    setProgress(4);
    setBackgroundRemovedImage("");
    setBgRemovalConfidence(0);

    const { dataUrl: bgRemovedSrc, confidence: bgConfidence } =
      await removeBackgroundFromCapture(imageSrc);

    setBackgroundRemovedImage(bgRemovedSrc);
    setBgRemovalConfidence(bgConfidence);

    await runNikOCR(bgRemovedSrc);
  };

  const captureMDN = async () => {
    if (!webcamRef.current) return;

    const video = webcamRef.current.video;

    if (!video) return;

    const containerElement = webcamContainerRef.current;

    if (!containerElement) return;

    const overlayBox: BoundingBox = {
      x: mdnOverlayArea.x,
      y: mdnOverlayArea.y,
      width: mdnOverlayArea.width,
      height: mdnOverlayArea.height,
    };

    const capturedFrame = captureOverlayFrame(
      video,
      containerElement,
      overlayBox,
    );

    if (!capturedFrame) return;

    const { imageSrc, cameraDebugData: debugData } = capturedFrame;

    setCameraDebugData(debugData);

    setImage(imageSrc);

    setOcrStatus("Removing background");
    setProgress(4);
    setBackgroundRemovedImage("");
    setBgRemovalConfidence(0);

    const { dataUrl: bgRemovedSrc, confidence: bgConfidence } =
      await removeBackgroundFromCapture(imageSrc);

    setBackgroundRemovedImage(bgRemovedSrc);
    setBgRemovalConfidence(bgConfidence);

    await runMdnOCR(bgRemovedSrc);
  };

  /**
   * UPLOAD IMAGE
   */

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];

    if (!file) return;

    if (!file.type.startsWith("image/")) {
      alert("File harus image");

      return;
    }

    const reader = new FileReader();

    reader.onload = async () => {
      const result = reader.result as string;

      setActiveCaptureOverlay("nik");

      setImage(result);

      await runOCR(result);
    };

    reader.readAsDataURL(file);
  };

  const handleMdnUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];

    if (!file) return;

    if (!file.type.startsWith("image/")) {
      alert("File harus image");

      return;
    }

    const reader = new FileReader();

    reader.onload = async () => {
      const result = reader.result as string;

      setActiveCaptureOverlay("mdn");

      setImage(result);

      await runMdnOCR(result);
    };

    reader.readAsDataURL(file);
  };

  const progressWidth = useMemo(() => {
    return `${progress}%`;
  }, [progress]);

  const isMdnMode = activeCaptureOverlay === "mdn";

  const captureByMode = async () => {
    if (isMdnMode) {
      await captureMDN();

      return;
    }

    await capture();
  };

  const uploadByMode = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isMdnMode) {
      await handleMdnUpload(e);

      return;
    }

    await handleUpload(e);
  };

  return (
    <div
      style={{
        maxWidth: 1400,
        margin: "0 auto",
        padding: 20,
        fontFamily: "Arial",
      }}
    >
      <h1>OCR KTP Indonesia - OCR Per Field</h1>

      <div
        style={{
          display: "flex",
          gap: 20,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h3>Camera</h3>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: 8,
              margin: "8px 0 12px",
              maxWidth: WEBCAM_PREVIEW_WIDTH,
            }}
          >
            <button
              type="button"
              onClick={() => {
                setActiveCaptureOverlay("nik");
              }}
              style={{
                border: "1px solid #d1d5db",
                borderRadius: 10,
                padding: "10px 12px",
                background: isMdnMode ? "#fff" : "#10b981",
                color: isMdnMode ? "#111827" : "#fff",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Mode NIK
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveCaptureOverlay("mdn");
              }}
              style={{
                border: "1px solid #d1d5db",
                borderRadius: 10,
                padding: "10px 12px",
                background: isMdnMode ? "#10b981" : "#fff",
                color: isMdnMode ? "#fff" : "#111827",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Mode MDN
            </button>
          </div>

          <p
            style={{
              margin: "6px 0 10px",
              color: "#065f46",
              fontWeight: 600,
            }}
          >
            Active Overlay: {activeCaptureOverlay.toUpperCase()}
          </p>

          {/* <Webcam
              ref={webcamRef}
              audio={false}
              screenshotFormat="image/png"
              videoConstraints={videoConstraints}
              style={{
                width: 500,
                borderRadius: 12,
                border: '1px solid #ddd',
              }}
            /> */}
          <div
            ref={webcamContainerRef}
            style={{
              width: "100%",
              maxWidth: WEBCAM_PREVIEW_WIDTH,
              aspectRatio: WEBCAM_ASPECT_RATIO,
              borderRadius: 12,
              border: "1px solid #ddd",
              overflow: "hidden",
              position: "relative",
            }}
          >
            <Webcam
              ref={webcamRef}
              audio={false}
              screenshotFormat="image/png"
              forceScreenshotSourceSize
              videoConstraints={videoConstraints}
              onUserMedia={() => {
                setTimeout(() => {
                  setCameraReady(true);
                }, 1500);
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
                left: `${activeOverlayArea.x * 100}%`,
                top: `${activeOverlayArea.y * 100}%`,
                width: `${activeOverlayArea.width * 100}%`,
                height: `${activeOverlayArea.height * 100}%`,
                border: "2px solid #10b981",
                borderRadius: 6,
                boxShadow: "0 0 0 9999px rgba(0,0,0,0.2)",
                pointerEvents: "none",
              }}
            />
          </div>

          <div
            style={{
              display: "flex",
              gap: 10,
              marginTop: 10,
              flexDirection: "column",
            }}
          >
            <button
              disabled={!cameraReady || loading}
              onClick={captureByMode}
              style={{
                fontWeight: 700,
              }}
            >
              {isMdnMode ? "Capture MDN" : "Capture NIK"}
            </button>

            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <input
                type="checkbox"
                checked={visualVerificationMode}
                onChange={(event) => {
                  setVisualVerificationMode(event.target.checked);
                }}
              />
              <span>Visual verification mode</span>
            </label>

            <div>
              <div>
                {isMdnMode ? "Upload Starter Pack (MDN)" : "Upload KTP"}
              </div>
              <input
                type="file"
                accept="image/*"
                onChange={uploadByMode}
                disabled={loading}
              />
            </div>
          </div>
        </div>

        <div>
          <h3>Original</h3>

          {image && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={image}
              alt="Original"
              style={{
                width: "auto",
                maxWidth: 500,
                display: "block",
                borderRadius: 12,
                border: "1px solid #ddd",
              }}
            />
          )}
        </div>
      </div>

      {/* =========================
            BACKGROUND REMOVED PREVIEW
        ========================= */}

      {backgroundRemovedImage && (
        <div
          style={{
            marginTop: 30,
            border: "1px solid #d1fae5",
            borderRadius: 12,
            padding: 16,
            background: "#f0fdf4",
          }}
        >
          <h3 style={{ marginTop: 0, marginBottom: 12 }}>
            Background Removed Preview
          </h3>

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              marginBottom: 14,
            }}
          >
            <div
              style={{
                padding: "6px 12px",
                background: "#fff",
                border: "1px solid #6ee7b7",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              Background Removal Confidence :{" "}
              {bgRemovalConfidence.toFixed(1)}%
            </div>

            {nikData.confidence > 0 && (
              <div
                style={{
                  padding: "6px 12px",
                  background: "#fff",
                  border: "1px solid #6ee7b7",
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                OCR Confidence : {nikData.confidence.toFixed(1)}%
              </div>
            )}

            {mdnData.confidence > 0 && (
              <div
                style={{
                  padding: "6px 12px",
                  background: "#fff",
                  border: "1px solid #6ee7b7",
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                OCR Confidence (MDN) : {mdnData.confidence.toFixed(1)}%
              </div>
            )}
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: 12,
            }}
          >
            <div>
              <h4 style={{ marginBottom: 8 }}>Original Capture</h4>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={image}
                alt="Original Capture"
                style={{
                  width: "100%",
                  borderRadius: 10,
                  border: "1px solid #ddd",
                }}
              />
            </div>

            <div>
              <h4 style={{ marginBottom: 8 }}>Background Removed</h4>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={backgroundRemovedImage}
                alt="Background Removed"
                style={{
                  width: "100%",
                  borderRadius: 10,
                  border: "1px solid #ddd",
                  background: "#fff",
                }}
              />
            </div>

            {(processedFields.nik_clean_bw ||
              processedFields.mdn_sharpen) && (
              <div>
                <h4 style={{ marginBottom: 8 }}>
                  Black &amp; White OCR Preview
                </h4>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={
                    processedFields.nik_clean_bw ||
                    processedFields.mdn_sharpen
                  }
                  alt="Black & White Preview"
                  style={{
                    width: "100%",
                    borderRadius: 10,
                    border: "1px solid #ddd",
                    background: "#fff",
                    imageRendering: "crisp-edges",
                  }}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {loading && (
        <div
          style={{
            marginTop: 30,
          }}
        >
          <h3 style={{ marginBottom: 8 }}>OCR Processing</h3>

          <div
            style={{
              marginBottom: 12,
              lineHeight: 1.5,
            }}
          >
            Current Step: {ocrStatus || "Starting"}
            <div>Progress: {progress}%</div>
          </div>

          <div
            style={{
              width: "100%",
              height: 14,
              background: "#eee",
              borderRadius: 999,
              overflow: "hidden",
              position: "relative",
            }}
          >
            <div
              style={{
                width: progressWidth,
                height: "100%",
                background: "#111",
                transition: "width .3s ease",
              }}
            />
          </div>
        </div>
      )}

      {visualVerificationMode && cameraDebugData && (
        <div
          style={{
            marginTop: 30,
            border: "1px solid #ddd",
            borderRadius: 12,
            padding: 16,
          }}
        >
          <h3>Camera Visual Verification</h3>

          <p
            style={{
              margin: "8px 0",
              lineHeight: 1.5,
            }}
          >
            Video: {cameraDebugData.videoWidth}x{cameraDebugData.videoHeight} |
            Container: {cameraDebugData.containerWidth}x
            {cameraDebugData.containerHeight}
          </p>

          <p
            style={{
              margin: "8px 0",
              lineHeight: 1.5,
            }}
          >
            Overlay(0-1): x={cameraDebugData.overlayBox.x.toFixed(3)} y=
            {cameraDebugData.overlayBox.y.toFixed(3)} w=
            {cameraDebugData.overlayBox.width.toFixed(3)} h=
            {cameraDebugData.overlayBox.height.toFixed(3)} | Crop(px): x=
            {cameraDebugData.cropArea.cropX} y={cameraDebugData.cropArea.cropY}
            w={cameraDebugData.cropArea.cropWidth} h=
            {cameraDebugData.cropArea.cropHeight}
          </p>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
              gap: 12,
            }}
          >
            <div>
              <h4 style={{ marginBottom: 8 }}>Full Frame</h4>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={cameraDebugData.fullFrameImage}
                alt="Camera full frame"
                style={{
                  width: "100%",
                  borderRadius: 10,
                  border: "1px solid #ddd",
                }}
              />
            </div>

            <div>
              <h4 style={{ marginBottom: 8 }}>Overlay to Crop Mapping</h4>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={cameraDebugData.overlayDebugImage}
                alt="Overlay crop debug"
                style={{
                  width: "100%",
                  borderRadius: 10,
                  border: "1px solid #ddd",
                }}
              />
            </div>

            <div>
              <h4 style={{ marginBottom: 8 }}>Captured Result for OCR</h4>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={image}
                alt="Captured NIK"
                style={{
                  width: "100%",
                  borderRadius: 10,
                  border: "1px solid #ddd",
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* =========================
            FULL PREPROCESSED IMAGE
        ========================= */}

      <div
        style={{
          marginTop: 30,
        }}
      >
        <h2>Processed Full KTP Image</h2>

        {fullProcessedImage && (
          <div
            style={{
              maxWidth: 700,
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={fullProcessedImage}
              alt="Processed Full KTP"
              style={{
                width: "100%",
                border: "1px solid #ddd",
                borderRadius: 12,
              }}
            />
          </div>
        )}
      </div>

      {/* =========================
            CROPPED OCR FIELDS
        ========================= */}

      <div
        style={{
          marginTop: 30,
        }}
      >
        <h2>Processed OCR Fields (Crop)</h2>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
            gap: 20,
          }}
        >
          {Object.entries(processedFields).map(([key, value]) => (
            <div key={key}>
              <h4>{key.toUpperCase()}</h4>

              <div
                style={{
                  display: "inline-block",
                  marginBottom: 8,
                  padding: "4px 8px",
                  borderRadius: 999,
                  background: "#f3f4f6",
                  border: "1px solid #e5e7eb",
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                Confidence:{" "}
                {typeof processedFieldConfidence[key] === "number"
                  ? `${processedFieldConfidence[key].toFixed(2)}%`
                  : "-"}
              </div>

              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={value}
                alt={key}
                style={{
                  width: "100%",
                  background: key === "nik_clean_bw" ? "#fff" : undefined,
                  objectFit: key === "nik_clean_bw" ? "contain" : undefined,
                  imageRendering:
                    key === "nik_clean_bw" ? "crisp-edges" : undefined,
                  border: "1px solid #ddd",
                  borderRadius: 12,
                }}
              />
            </div>
          ))}
        </div>
      </div>

      {/* =========================
            OCR RESULT
        ========================= */}

      <div
        style={{
          marginTop: 30,
          padding: 20,
          border: "1px solid #ddd",
          borderRadius: 12,
        }}
      >
        <h2>Hasil OCR NIK</h2>

        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
          }}
        >
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>Field</th>
              <th style={{ textAlign: "left" }}>Value</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>NIK</td>
              <td>{nikData.nik || ktpData.nik}</td>
            </tr>

            <tr>
              <td>Confidence</td>
              <td>
                {nikData.confidence > 0 ? nikData.confidence.toFixed(2) : "-"}
              </td>
            </tr>

            <tr>
              <td>Raw Candidates</td>
              <td style={{ whiteSpace: "pre-wrap" }}>
                {nikData.rawCandidates.join("\n") || "-"}
              </td>
            </tr>
          </tbody>
        </table>

        <pre
          style={{
            marginTop: 14,
            background: "#f5f5f5",
            padding: 14,
            borderRadius: 10,
            whiteSpace: "pre-wrap",
            fontSize: 13,
          }}
        >
          {nikDebugText ||
            `OCR PASSES
-

OCR CONFIDENCE
-

NORMALIZED NIK
-

SELECTED NIK
-`}
        </pre>
      </div>

      <div
        style={{
          marginTop: 20,
          padding: 20,
          border: "1px solid #ddd",
          borderRadius: 12,
        }}
      >
        <h2>Hasil OCR MDN</h2>

        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
          }}
        >
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>Field</th>
              <th style={{ textAlign: "left" }}>Value</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>MDN</td>
              <td>{mdnData.mdn}</td>
            </tr>

            <tr>
              <td>Confidence</td>
              <td>{mdnData.confidence.toFixed(2)}</td>
            </tr>

            <tr>
              <td>Raw Candidates</td>
              <td>{mdnData.rawCandidates.join(", ") || "-"}</td>
            </tr>
          </tbody>
        </table>

        <pre
          style={{
            marginTop: 14,
            background: "#f5f5f5",
            padding: 14,
            borderRadius: 10,
            whiteSpace: "pre-wrap",
            fontSize: 13,
          }}
        >
          {mdnDebugText ||
            `OCR PASSES
-

OCR CONFIDENCE
-

NORMALIZED MDN
-

SELECTED MDN
-`}
        </pre>
      </div>

      {/* =========================
            RAW OCR TEXT
        ========================= */}

      <div
        style={{
          marginTop: 30,
        }}
      >
        <h2>Raw OCR Text</h2>

        <pre
          style={{
            background: "#f5f5f5",
            padding: 20,
            borderRadius: 12,
            whiteSpace: "pre-wrap",
            fontSize: 14,
          }}
        >
          {rawText}
        </pre>
      </div>
    </div>
  );
};
