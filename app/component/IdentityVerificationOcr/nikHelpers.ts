import Tesseract from 'tesseract.js';
import {
  adaptiveThreshold,
  computeGrayWithContrast,
  drawMonochrome,
  loadImage,
  medianFilterGray,
  morphologyClose,
} from './imageHelpers';
import {
  NikPreprocessPipeline,
  NikOcrPass,
  NikOcrPassResult,
} from './interface/IIdentityOcr';
import {NikHelpersOptions} from './type/typeNikHelper';
import {RecognizeOptions} from './type/typeRecognizeOptions';

export const createNikOcrHelpers = ({
  NIK_CHAR_MAP,
  NIK_OCR_WHITELIST,
  NIK_DYNAMIC_SCALE_HEIGHT_THRESHOLD,
  NIK_DIGIT_CORRECTION_MAP,
}: NikHelpersOptions) => {
  const mapNikLikeCharsToDigits = (text: string) => {
    const compact = text.toUpperCase().replace(/[^A-Z0-9|]/g, '');

    return compact
      .split('')
      .map(char => {
        if (/\d/.test(char)) return char;

        if (char === '|') return '1';

        return NIK_CHAR_MAP[char] || '';
      })
      .join('');
  };

  const scoreNikCandidate = (candidate: string) => {
    if (!/^\d{16}$/.test(candidate)) return -1;

    let score = 0;

    if (!candidate.startsWith('0')) score += 2;

    const day = Number(candidate.slice(6, 8));
    const month = Number(candidate.slice(8, 10));

    if (day >= 1 && day <= 31) score += 3;
    if (month >= 1 && month <= 12) score += 3;
    if (!/(\d)\1{7,}/.test(candidate)) score += 1;

    return score;
  };

  const extractDirectNikCandidates = (text: string) => {
    const lines = text
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);

    const candidates: string[] = [];

    lines.forEach((line, index) => {
      if (!/\bNIK\b/i.test(line)) return;

      const lineCandidates = [line, `${line} ${lines[index + 1] || ''}`.trim()];

      lineCandidates.forEach(lineCandidate => {
        const directDigits = lineCandidate.replace(/\D/g, '');

        if (directDigits.length >= 16) {
          for (let start = 0; start <= directDigits.length - 16; start += 1) {
            const candidate = directDigits.slice(start, start + 16);

            if (/^\d{16}$/.test(candidate)) {
              candidates.push(candidate);
            }
          }
        }

        const mappedDigits = mapNikLikeCharsToDigits(lineCandidate);

        if (mappedDigits.length >= 16) {
          for (let start = 0; start <= mappedDigits.length - 16; start += 1) {
            const candidate = mappedDigits.slice(start, start + 16);

            if (/^\d{16}$/.test(candidate)) {
              candidates.push(candidate);
            }
          }
        }
      });
    });

    return Array.from(new Set(candidates));
  };

  const pickBestNikWindow = (digitStream: string) => {
    if (digitStream.length < 16) return '';

    let bestNik = '';
    let bestScore = -1;

    for (let index = 0; index <= digitStream.length - 16; index += 1) {
      const candidate = digitStream.slice(index, index + 16);
      const score = scoreNikCandidate(candidate);

      if (score > bestScore) {
        bestScore = score;
        bestNik = candidate;
      }
    }

    return bestNik;
  };

  const extractNik = (text: string) => {
    const upperText = text.toUpperCase();

    const directCandidates = extractDirectNikCandidates(upperText);

    if (directCandidates.length > 0) {
      return (
        directCandidates
          .map(candidate => ({candidate, score: scoreNikCandidate(candidate)}))
          .sort((left, right) => right.score - left.score)[0]?.candidate || ''
      );
    }

    const colonSplit = upperText.split(':');

    const rightSideOfColon =
      colonSplit.length > 1 ? colonSplit.slice(1).join(' ') : upperText;

    const withoutNikLabel = upperText.replaceAll('NIK', ' ');

    const digitStreams = [
      mapNikLikeCharsToDigits(rightSideOfColon),
      mapNikLikeCharsToDigits(withoutNikLabel),
      mapNikLikeCharsToDigits(upperText),
    ];

    let bestNik = '';
    let bestScore = -1;

    digitStreams.forEach(stream => {
      const candidate = pickBestNikWindow(stream);
      const score = scoreNikCandidate(candidate);

      if (score > bestScore) {
        bestScore = score;
        bestNik = candidate;
      }
    });

    return bestNik;
  };

  const pickBestNikFromTexts = (texts: string[]) => {
    const preferredCandidates: string[] = [];

    let bestNik = '';
    let bestScore = -1;

    texts.forEach(text => {
      const nikCandidate = extractNik(text);
      const score = scoreNikCandidate(nikCandidate);

      if (score >= 8) {
        preferredCandidates.push(nikCandidate);
      }

      if (score > bestScore) {
        bestScore = score;
        bestNik = nikCandidate;
      }
    });

    if (preferredCandidates.length > 0) {
      return preferredCandidates[0];
    }

    return bestNik;
  };

  const buildNikPreprocessPipeline = async (
    imageSrc: string,
  ): Promise<NikPreprocessPipeline> => {
    const img = await loadImage(imageSrc);

    const scaleFactor = img.height < NIK_DYNAMIC_SCALE_HEIGHT_THRESHOLD ? 3 : 2;

    const width = Math.max(1, Math.floor(img.width * scaleFactor));
    const height = Math.max(1, Math.floor(img.height * scaleFactor));

    const sourceCanvas = document.createElement('canvas');

    sourceCanvas.width = width;
    sourceCanvas.height = height;

    const sourceCtx = sourceCanvas.getContext('2d');

    if (!sourceCtx) {
      return {
        source: imageSrc,
        grayscale: imageSrc,
        adaptive: imageSrc,
        morphology: imageSrc,
        sourceHeight: img.height,
        scaleFactor,
      };
    }

    sourceCtx.imageSmoothingEnabled = true;
    sourceCtx.imageSmoothingQuality = 'high';

    sourceCtx.drawImage(img, 0, 0, width, height);

    const sourceImageData = sourceCtx.getImageData(0, 0, width, height);

    const gray = computeGrayWithContrast(sourceImageData.data, 1.18);
    const grayDenoised = medianFilterGray(gray, width, height);
    const adaptive = adaptiveThreshold(grayDenoised, width, height);
    const morphClosed = morphologyClose(adaptive, width, height);
    const morphDenoised = medianFilterGray(morphClosed, width, height);

    return {
      source: sourceCanvas.toDataURL('image/png', 1),
      grayscale: drawMonochrome(grayDenoised, width, height),
      adaptive: drawMonochrome(adaptive, width, height),
      morphology: drawMonochrome(morphDenoised, width, height),
      sourceHeight: img.height,
      scaleFactor,
    };
  };

  const recognizeNikPass = async (pass: NikOcrPass) => {
    const options: RecognizeOptions = {
      tessedit_pageseg_mode: pass.psm,
      tessedit_char_whitelist: NIK_OCR_WHITELIST,
    };

    const result = await Tesseract.recognize(pass.image, 'eng', options);

    const passResult: NikOcrPassResult = {
      ...pass,
      text: result.data.text.trim(),
      confidence: Number.isFinite(result.data.confidence)
        ? result.data.confidence
        : 0,
      candidate: '',
    };

    return passResult;
  };

  const buildNikPositionVotes = (passes: NikOcrPassResult[]) => {
    const positionVotes: Array<Record<string, number>> = Array.from(
      {length: 16},
      () => ({}),
    );

    const supportMap: Record<string, number> = {};

    passes.forEach(pass => {
      if (!/^\d{16}$/.test(pass.candidate)) return;

      const confidenceWeight =
        0.45 + Math.max(0, Math.min(100, pass.confidence)) / 100;

      const voteWeight = pass.weight * confidenceWeight;

      supportMap[pass.candidate] =
        (supportMap[pass.candidate] || 0) + voteWeight;

      pass.candidate.split('').forEach((digit, position) => {
        const boostForLeadingOne = position === 0 && digit === '1' ? 0.25 : 0;

        positionVotes[position][digit] =
          (positionVotes[position][digit] || 0) +
          voteWeight +
          boostForLeadingOne;
      });
    });

    return {
      positionVotes,
      supportMap,
    };
  };

  const composeNikFromVotes = (
    positionVotes: Array<Record<string, number>>,
  ) => {
    let output = '';

    for (let position = 0; position < 16; position += 1) {
      const entries = Object.entries(positionVotes[position]);

      if (entries.length === 0) {
        output += '0';

        continue;
      }

      entries.sort((left, right) => right[1] - left[1]);

      output += entries[0][0];
    }

    return output;
  };

  const isWithinRange = (value: number, min: number, max: number) => {
    return value >= min && value <= max;
  };

  const scoreRangeRule = (
    value: number,
    min: number,
    max: number,
    passScore: number,
    failScore: number,
  ) => {
    return isWithinRange(value, min, max) ? passScore : failScore;
  };

  const scoreNikPatternRules = (candidate: string) => {
    let score = 0;

    if (!candidate.startsWith('0')) score += 1;
    if (!/^(\d)\1{5,}$/.test(candidate.slice(0, 6))) score += 1;
    if (!/(\d)\1{7,}/.test(candidate)) score += 1;

    return score;
  };

  const scoreNikRegionCodes = (candidate: string) => {
    const provinceCode = Number(candidate.slice(0, 2));
    const cityCode = Number(candidate.slice(2, 4));
    const districtCode = Number(candidate.slice(4, 6));

    return (
      scoreRangeRule(provinceCode, 11, 94, 3, -3) +
      scoreRangeRule(cityCode, 1, 99, 2, -2) +
      scoreRangeRule(districtCode, 1, 99, 1, -1)
    );
  };

  const scoreNikBirthCode = (candidate: string) => {
    const dayCode = Number(candidate.slice(6, 8));
    const monthCode = Number(candidate.slice(8, 10));

    const isMaleDay = isWithinRange(dayCode, 1, 31);
    const isFemaleDay = isWithinRange(dayCode, 41, 71);

    const dayScore = isMaleDay || isFemaleDay ? 3 : -3;
    const monthScore = scoreRangeRule(monthCode, 1, 12, 2, -2);

    return dayScore + monthScore;
  };

  const scoreNikContext = (candidate: string) => {
    if (!/^\d{16}$/.test(candidate)) return -999;

    return (
      scoreNikRegionCodes(candidate) +
      scoreNikBirthCode(candidate) +
      scoreNikPatternRules(candidate)
    );
  };

  const scoreCandidateFromVotes = (
    candidate: string,
    positionVotes: Array<Record<string, number>>,
  ) => {
    if (!/^\d{16}$/.test(candidate)) return -999;

    let score = 0;

    candidate.split('').forEach((digit, position) => {
      const digitVote = positionVotes[position][digit] || 0;

      const maxVote =
        Math.max(0, ...Object.values(positionVotes[position])) || 1;

      score += digitVote / maxVote;
    });

    return score;
  };

  const generateNikCorrectionVariants = (candidate: string) => {
    const variants = new Set<string>([candidate]);

    if (!/^\d{16}$/.test(candidate)) return Array.from(variants);

    for (let position = 0; position < 10; position += 1) {
      const current = candidate[position];

      const replacements = NIK_DIGIT_CORRECTION_MAP[current] || [];

      replacements.forEach(replacement => {
        const mutated =
          candidate.slice(0, position) +
          replacement +
          candidate.slice(position + 1);

        variants.add(mutated);
      });
    }

    return Array.from(variants);
  };

  const resolveBestNikCandidate = (passes: NikOcrPassResult[]) => {
    const enrichedPasses = passes.map(pass => ({
      ...pass,
      candidate: extractNik(pass.text),
    }));

    const {positionVotes, supportMap} = buildNikPositionVotes(enrichedPasses);
    const votedNik = composeNikFromVotes(positionVotes);
    const pool = new Set<string>();

    const fallbackNik = pickBestNikFromTexts(
      enrichedPasses.map(pass => pass.text),
    );

    if (fallbackNik) pool.add(fallbackNik);
    if (/^\d{16}$/.test(votedNik)) pool.add(votedNik);

    enrichedPasses.forEach(pass => {
      if (/^\d{16}$/.test(pass.candidate)) {
        pool.add(pass.candidate);
      }
    });

    Array.from(pool).forEach(candidate => {
      generateNikCorrectionVariants(candidate).forEach(variant => {
        pool.add(variant);
      });
    });

    let bestCandidate = '';
    let bestScore = -Infinity;

    Array.from(pool).forEach(candidate => {
      if (!/^\d{16}$/.test(candidate)) return;

      const structureScore = scoreNikCandidate(candidate);
      const contextScore = scoreNikContext(candidate);
      const voteScore = scoreCandidateFromVotes(candidate, positionVotes);
      const supportScore = supportMap[candidate] || 0;

      const totalScore =
        structureScore * 2 + contextScore * 2 + voteScore + supportScore;

      if (totalScore > bestScore) {
        bestScore = totalScore;
        bestCandidate = candidate;
      }
    });

    return {
      nik: bestCandidate,
      votedNik,
      enrichedPasses,
    };
  };

  return {
    extractNik,
    mapNikLikeCharsToDigits,
    buildNikPreprocessPipeline,
    recognizeNikPass,
    resolveBestNikCandidate,
  };
};
