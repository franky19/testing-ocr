export type IdentityFields = {
  nik: string;
  kk: string;
  name: string;
  address: string;
};

export type ConfidenceEngine = {
  ocrConfidence: number;
  regexValidity: number;
  patternValidity: number;
  imageQualityScore: number;
  finalScore: number;
  targetReached: boolean;
};

export type ImageQualityInfo = {
  accepted: boolean;
  reasons: string[];
  blurVariance: number;
  brightness: number;
  glareRatio: number;
};

export type OcrTelemetry = {
  deviceTier: 'low' | 'mid' | 'high';
  decodeMs: number;
  passCount: number;
  cheapPassCount: number;
  heavyPassCount: number;
  passBudgetInitial: number;
  passBudgetRemaining: number;
  stopReason: string;
  pipelineMode: 'cheap_only' | 'cheap_then_heavy';
  stageDurations: Record<string, number>;
  totalMs: number;
  nikFound: boolean;
  finalConfidence: number;
};

export type LocalOcrResult = {
  fields: IdentityFields;
  rawText: string;
  confidence: number;
  confidenceEngine: ConfidenceEngine;
  quality?: ImageQualityInfo;
  telemetry?: OcrTelemetry;
  sourceImageDataUrl: string;
  previewCropDataUrl?: string;
};
