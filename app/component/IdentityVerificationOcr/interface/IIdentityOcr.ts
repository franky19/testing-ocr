export interface KTPData {
  nik: string;
  nama: string;
  tempatLahir: string;
  tanggalLahir: string;
  jenisKelamin: string;
  alamat: string;
  agama: string;
  status: string;
}
export interface NikPreprocessPipeline {
  source: string;
  grayscale: string;
  adaptive: string;
  morphology: string;
  sourceHeight: number;
  scaleFactor: number;
}

export interface NikOcrPass {
  label: string;
  image: string;
  psm: '6' | '7' | '8' | '13';
  weight: number;
}

export interface NikOcrPassResult extends NikOcrPass {
  text: string;
  confidence: number;
  candidate: string;
}
