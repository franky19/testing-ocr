import {ConfidenceEngine, IdentityFields, ImageQualityInfo} from './types';
import {isValidNikPattern} from './validation';

const clamp = (value: number) => {
  return Math.max(0, Math.min(100, value));
};

export const buildConfidenceEngine = (params: {
  fields: IdentityFields;
  quality?: ImageQualityInfo;
  ocrConfidence: number;
}): ConfidenceEngine => {
  const {fields, quality, ocrConfidence} = params;

  const regexValidity = /^\d{16}$/.test(fields.nik) ? 100 : 20;
  const patternValidity = isValidNikPattern(fields.nik) ? 100 : 30;

  const imageQualityScore = quality
    ? clamp(
        100 -
          Math.abs(quality.brightness - 150) * 0.7 -
          quality.glareRatio * 180 -
          (quality.blurVariance < 70 ? 25 : 0),
      )
    : 55;

  const completenessBoost =
    [fields.name, fields.address].filter(Boolean).length * 4;

  const finalScore = clamp(
    ocrConfidence * 0.45 +
      regexValidity * 0.2 +
      patternValidity * 0.2 +
      imageQualityScore * 0.15 +
      completenessBoost,
  );

  return {
    ocrConfidence: clamp(ocrConfidence),
    regexValidity,
    patternValidity,
    imageQualityScore,
    finalScore,
    targetReached: finalScore >= 95,
  };
};
