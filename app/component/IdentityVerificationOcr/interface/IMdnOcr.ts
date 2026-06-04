export interface MDNData {
  mdn: string;
  confidence: number;
  rawCandidates: string[];
}

export interface MdnPreprocessPipeline {
  source: string;
  grayscale: string;
  adaptive: string;
  morphology: string;
  sharpen: string;
  sourceWidth: number;
  sourceHeight: number;
  scaleFactor: number;
  regionLabel: string;
}

export interface MdnOcrPass {
  label: string;
  image: string;
  psm: '6' | '7';
  weight: number;
}

export interface MdnOcrPassResult extends MdnOcrPass {
  text: string;
  confidence: number;
  candidate: string;
}
