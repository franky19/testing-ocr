import Tesseract from 'tesseract.js';
import {BoundingBox} from './interface/ICamera';
import {
  MdnPreprocessPipeline,
  MdnOcrPass,
  MdnOcrPassResult,
} from './interface/IMdnOcr';
import {
  adaptiveThreshold,
  clampByte,
  computeGrayWithContrast,
  cropImageByNormalizedArea,
  drawMonochrome,
  loadImage,
  morphologyClose,
} from './imageHelpers';
import {MdnHelpersOptions} from './type/typeMdnOcrHelper';
import {RecognizeOptions} from './type/typeRecognizeOptions';

export const createMdnOcrHelpers = ({
  setOcrStatus,
  MDN_OCR_WHITELIST,
  MDN_CHAR_CORRECTION_MAP,
  MDN_PRIMARY_REGION,
}: MdnHelpersOptions) => {
  const applyMdnCharCorrection = (text: string) => {
    return text
      .split('')
      .map(char => MDN_CHAR_CORRECTION_MAP[char] || char)
      .join('');
  };

  const normalizeIndonesianMdn = (raw: string) => {
    const corrected = applyMdnCharCorrection(raw);

    const compact = corrected
      .replaceAll(/\s+/g, '')
      .replaceAll(/[-._]/g, '')
      .replaceAll(/\D/g, '');

    if (compact.startsWith('62')) {
      return `0${compact.slice(2)}`;
    }

    return compact;
  };

  const longestDigitRunLength = (raw: string) => {
    const matches = Array.from(raw.matchAll(/\d+/g)).map(entry => entry[0]);

    if (matches.length === 0) return 0;

    return matches.reduce((maxLength, current) => {
      return Math.max(maxLength, current.length);
    }, 0);
  };

  const countBlackPixelsInSquare = (
    adaptiveBinary: Uint8ClampedArray,
    width: number,
    x: number,
    y: number,
    side: number,
  ) => {
    let blackCount = 0;

    for (let py = y; py < y + side; py += 1) {
      for (let px = x; px < x + side; px += 1) {
        if (adaptiveBinary[py * width + px] === 0) {
          blackCount += 1;
        }
      }
    }

    return blackCount;
  };

  const buildSquareScanCandidates = (
    width: number,
    height: number,
    side: number,
    step: number,
  ) => {
    const candidates: Array<{x: number; y: number}> = [];

    for (let y = 0; y <= height - side; y += step) {
      for (let x = 0; x <= width - side; x += step) {
        candidates.push({x, y});
      }
    }

    return candidates;
  };

  const detectDenseSquareArea = (
    adaptiveBinary: Uint8ClampedArray,
    width: number,
    height: number,
  ) => {
    if (width < 40 || height < 40) return null;

    const side = Math.max(24, Math.floor(Math.min(width, height) * 0.22));
    const step = Math.max(8, Math.floor(side / 4));

    let bestDensity = 0;
    let bestBox: {
      x: number;
      y: number;
      side: number;
    } | null = null;

    const evaluateDensity = (x: number, y: number) => {
      const blackCount = countBlackPixelsInSquare(
        adaptiveBinary,
        width,
        x,
        y,
        side,
      );
      const density = blackCount / (side * side);

      if (density > bestDensity) {
        bestDensity = density;
        bestBox = {x, y, side};
      }
    };

    const scanCandidates = buildSquareScanCandidates(width, height, side, step);

    scanCandidates.forEach(candidate => {
      evaluateDensity(candidate.x, candidate.y);
    });

    if (!bestBox || bestDensity < 0.58) return null;

    return bestBox;
  };

  const maskDenseSquareArea = (
    source: Uint8ClampedArray,
    width: number,
    height: number,
    box: {
      x: number;
      y: number;
      side: number;
    } | null,
  ) => {
    if (!box) return source;

    const output = source.slice();

    for (let y = box.y; y < Math.min(height, box.y + box.side); y += 1) {
      for (let x = box.x; x < Math.min(width, box.x + box.side); x += 1) {
        output[y * width + x] = 255;
      }
    }

    return output;
  };

  const applySharpenGray = (
    source: Uint8ClampedArray,
    width: number,
    height: number,
  ) => {
    const output = source.slice();

    const kernel = [0, -1, 0, -1, 5, -1, 0, -1, 0];

    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        let sum = 0;
        let kernelIndex = 0;

        for (let ny = -1; ny <= 1; ny += 1) {
          for (let nx = -1; nx <= 1; nx += 1) {
            const value = source[(y + ny) * width + (x + nx)];
            sum += value * kernel[kernelIndex];
            kernelIndex += 1;
          }
        }

        output[y * width + x] = clampByte(sum);
      }
    }

    return output;
  };

  const buildMdnPreprocessPipeline = async (
    imageSrc: string,
    area: BoundingBox = MDN_PRIMARY_REGION,
    regionLabel = 'primary',
  ): Promise<MdnPreprocessPipeline> => {
    const croppedSrc = await cropImageByNormalizedArea(imageSrc, area);

    const img = await loadImage(croppedSrc);

    const scaleFactor = img.width < 500 ? 2 : 1;

    const width = Math.max(1, Math.floor(img.width * scaleFactor));
    const height = Math.max(1, Math.floor(img.height * scaleFactor));

    const sourceCanvas = document.createElement('canvas');

    sourceCanvas.width = width;
    sourceCanvas.height = height;

    const sourceCtx = sourceCanvas.getContext('2d');

    if (!sourceCtx) {
      return {
        source: croppedSrc,
        grayscale: croppedSrc,
        adaptive: croppedSrc,
        morphology: croppedSrc,
        sharpen: croppedSrc,
        sourceWidth: img.width,
        sourceHeight: img.height,
        scaleFactor,
        regionLabel,
      };
    }

    sourceCtx.imageSmoothingEnabled = true;
    sourceCtx.imageSmoothingQuality = 'high';
    sourceCtx.drawImage(img, 0, 0, width, height);

    const sourceImageData = sourceCtx.getImageData(0, 0, width, height);

    const gray = computeGrayWithContrast(sourceImageData.data, 1.22);
    const adaptive = adaptiveThreshold(gray, width, height);
    const denseSquare = detectDenseSquareArea(adaptive, width, height);
    const qrMaskedGray = maskDenseSquareArea(gray, width, height, denseSquare);
    const adaptiveMasked = adaptiveThreshold(qrMaskedGray, width, height);
    const morphology = morphologyClose(adaptiveMasked, width, height);
    const sharpen = applySharpenGray(qrMaskedGray, width, height);

    return {
      source: sourceCanvas.toDataURL('image/png', 1),
      grayscale: drawMonochrome(qrMaskedGray, width, height),
      adaptive: drawMonochrome(adaptiveMasked, width, height),
      morphology: drawMonochrome(morphology, width, height),
      sharpen: drawMonochrome(sharpen, width, height),
      sourceWidth: img.width,
      sourceHeight: img.height,
      scaleFactor,
      regionLabel,
    };
  };

  const extractMDN = (text: string) => {
    const corrected = applyMdnCharCorrection(text);

    const fromStarterPackRegex = Array.from(
      corrected.matchAll(/(?:62|0)[0-9\s\-._]{8,20}/g),
    ).map(entry => entry[0]);

    const fromDigitRun = Array.from(
      corrected.matchAll(/\d(?:[\s\-._]?\d){8,20}/g),
    ).map(entry => entry[0]);

    const merged = [...fromStarterPackRegex, ...fromDigitRun];

    const normalized = merged
      .map(normalizeIndonesianMdn)
      .filter(candidate => /^0\d+$/.test(candidate))
      .map(candidate => (candidate.startsWith('08') ? candidate : ''))
      .filter(Boolean)
      .filter(candidate => candidate.length >= 10 && candidate.length <= 15);

    if (normalized.length > 0) {
      return Array.from(new Set(normalized));
    }

    const fallback = normalizeIndonesianMdn(corrected);

    if (/^08\d{8,13}$/.test(fallback)) {
      return [fallback];
    }

    return [];
  };

  const isValidMdn = (candidate: string) => {
    return /^08\d{8,13}$/.test(candidate);
  };

  const recognizeMdnPass = async (pass: MdnOcrPass) => {
    const options: RecognizeOptions = {
      tessedit_pageseg_mode: pass.psm,
      tessedit_char_whitelist: MDN_OCR_WHITELIST,
    };

    const result = await Tesseract.recognize(pass.image, 'eng', options);

    const passResult: MdnOcrPassResult = {
      ...pass,
      text: result.data.text.trim(),
      confidence: Number.isFinite(result.data.confidence)
        ? result.data.confidence
        : 0,
      candidate: '',
    };

    return passResult;
  };

  const yieldMainThread = async () => {
    await new Promise(resolve => {
      setTimeout(resolve, 0);
    });
  };

  const buildMdnRegionProposals = (baseArea: BoundingBox) => {
    const rightBiasedArea: BoundingBox = {
      x: Math.min(0.95, baseArea.x + baseArea.width * 0.15),
      y: baseArea.y,
      width: Math.max(0.1, baseArea.width * 0.85),
      height: baseArea.height,
    };

    const centerArea: BoundingBox = {
      x: Math.min(0.95, baseArea.x + baseArea.width * 0.05),
      y: Math.min(0.95, baseArea.y + baseArea.height * 0.03),
      width: Math.max(0.1, baseArea.width * 0.9),
      height: Math.max(0.08, baseArea.height * 0.9),
    };

    return [baseArea, rightBiasedArea, centerArea];
  };

  const resolveBestMdnCandidate = (passes: MdnOcrPassResult[]) => {
    const enrichedPasses = passes.map(pass => {
      const candidates = extractMDN(pass.text);

      return {
        ...pass,
        candidate: candidates[0] || '',
      };
    });

    const candidateSupportCount: Record<string, number> = {};
    const candidateConfidenceSum: Record<string, number> = {};
    const candidateWeightedVote: Record<string, number> = {};

    enrichedPasses.forEach(pass => {
      const candidates = extractMDN(pass.text);

      Array.from(new Set(candidates)).forEach(candidate => {
        candidateSupportCount[candidate] =
          (candidateSupportCount[candidate] || 0) + 1;

        candidateConfidenceSum[candidate] =
          (candidateConfidenceSum[candidate] || 0) +
          Math.max(0, Math.min(100, pass.confidence));

        const confidenceWeight =
          0.45 + Math.max(0, Math.min(100, pass.confidence)) / 100;

        candidateWeightedVote[candidate] =
          (candidateWeightedVote[candidate] || 0) +
          pass.weight * confidenceWeight;
      });
    });

    const uniqueCandidates = Array.from(
      new Set(Object.keys(candidateSupportCount)),
    );

    const getTailNoisePenalty = (candidate: string) => {
      let penalty = 0;

      if (/0{2,}$/.test(candidate)) {
        penalty += 24;
      }

      if (/(\d)\1{3,}$/.test(candidate)) {
        penalty += 12;
      }

      return penalty;
    };

    const getContainmentSignal = (candidate: string) => {
      let coreBonus = 0;
      let longerPenalty = 0;

      uniqueCandidates.forEach(other => {
        if (other === candidate) return;

        const lengthDiff = Math.abs(candidate.length - other.length);

        if (lengthDiff < 1 || lengthDiff > 3) return;

        const otherSupport = candidateSupportCount[other] || 0;

        if (other.startsWith(candidate)) {
          coreBonus += otherSupport * 18;
        }

        if (candidate.startsWith(other)) {
          longerPenalty += otherSupport * 20;
        }
      });

      return {
        coreBonus,
        longerPenalty,
      };
    };

    let selected = '';
    let selectedScore = -Infinity;
    let selectedConfidence = 0;

    uniqueCandidates.forEach(candidate => {
      const confidence =
        (candidateConfidenceSum[candidate] || 0) /
        Math.max(1, candidateSupportCount[candidate] || 1);

      const length = candidate.length;
      const digitRunLength = longestDigitRunLength(candidate);

      let score = 0;

      if (candidate.startsWith('08')) score += 100;

      if (length >= 10 && length <= 12) score += 50;
      else if (length >= 13 && length <= 14) score += 35;
      else if (length === 15) score += 10;

      if ((candidateSupportCount[candidate] || 0) > 1) {
        score += 3;
      }

      score += confidence;
      score += digitRunLength;
      score += candidateWeightedVote[candidate] || 0;

      const tailNoisePenalty = getTailNoisePenalty(candidate);
      const {coreBonus, longerPenalty} = getContainmentSignal(candidate);

      score += coreBonus;
      score -= longerPenalty;
      score -= tailNoisePenalty;

      if (!isValidMdn(candidate)) {
        score -= 1000;
      }

      if (score > selectedScore) {
        selectedScore = score;
        selected = candidate;
        selectedConfidence = confidence;
      }
    });

    const sortedCandidates = uniqueCandidates.toSorted((left, right) => {
      const leftSupport = candidateSupportCount[left] || 0;
      const rightSupport = candidateSupportCount[right] || 0;

      if (rightSupport !== leftSupport) return rightSupport - leftSupport;

      const leftConfidence =
        (candidateConfidenceSum[left] || 0) / Math.max(1, leftSupport || 1);
      const rightConfidence =
        (candidateConfidenceSum[right] || 0) / Math.max(1, rightSupport || 1);

      return rightConfidence - leftConfidence;
    });

    return {
      mdn: isValidMdn(selected) ? selected : '',
      confidence: Number(selectedConfidence.toFixed(2)),
      enrichedPasses,
      uniqueCandidates: sortedCandidates,
    };
  };

  const runMdnPassGroup = async (
    pipeline: MdnPreprocessPipeline,
    groupLabel: string,
  ) => {
    const passes: MdnOcrPass[] = [
      {
        label: 'gray_psm7',
        image: pipeline.grayscale,
        psm: '7',
        weight: 1.3,
      },
      {
        label: 'adaptive_psm7',
        image: pipeline.adaptive,
        psm: '7',
        weight: 1.25,
      },
      {
        label: 'morphology_psm7',
        image: pipeline.morphology,
        psm: '7',
        weight: 1.1,
      },
      {
        label: 'sharpen_psm7',
        image: pipeline.sharpen,
        psm: '7',
        weight: 1,
      },
    ];

    setOcrStatus(`Running MDN OCR pass (gray) ${groupLabel}`);
    const pass1 = await recognizeMdnPass(passes[0]);

    setOcrStatus(`Running MDN OCR pass (adaptive) ${groupLabel}`);
    const pass2 = await recognizeMdnPass(passes[1]);

    setOcrStatus(`Running MDN OCR pass (morphology) ${groupLabel}`);
    const pass3 = await recognizeMdnPass(passes[2]);

    setOcrStatus(`Running MDN OCR pass (sharpen) ${groupLabel}`);
    const pass4 = await recognizeMdnPass(passes[3]);

    const resolved = resolveBestMdnCandidate([pass1, pass2, pass3, pass4]);

    return {
      resolved,
      pipeline,
    };
  };

  return {
    extractMDN,
    isValidMdn,
    yieldMainThread,
    buildMdnRegionProposals,
    buildMdnPreprocessPipeline,
    runMdnPassGroup,
    resolveBestMdnCandidate,
  };
};
