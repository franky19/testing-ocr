import {IdentityFields} from './types';

const fixDigitConfusion = (value: string) => {
  return String(value || '')
    .replace(/[OoQD]/g, '0')
    .replace(/[Il|!Ff]/g, '1')
    .replace(/[Bb]/g, '8')
    .replace(/[Ss]/g, '5');
};

export const normalizeNik = (value: string) => {
  return fixDigitConfusion(value).replace(/\D/g, '').slice(0, 16);
};

export const isValidNikPattern = (nik: string) => {
  if (!/^\d{16}$/.test(nik)) {
    return false;
  }

  const dayRaw = Number(nik.slice(6, 8));
  const day = dayRaw > 40 ? dayRaw - 40 : dayRaw;
  const month = Number(nik.slice(8, 10));
  return day >= 1 && day <= 31 && month >= 1 && month <= 12;
};

export const chooseBestNik = (text: string, preferredNik = '') => {
  const preferredNormalized = normalizeNik(preferredNik);
  if (
    preferredNormalized.length === 16 &&
    isValidNikPattern(preferredNormalized)
  ) {
    return preferredNormalized;
  }

  const source = String(text || '');
  const directNikMatches =
    source.match(/N\s*I\s*K[^A-Z0-9]{0,12}[0-9OQDBILS!\s:/.-]{12,48}/gi) || [];

  const directNikCandidates = directNikMatches
    .map(item => normalizeNik(item))
    .filter(candidate => candidate.length === 16)
    .sort((a, b) => {
      const aScore = (isValidNikPattern(a) ? 200 : 120) + new Set(a).size;
      const bScore = (isValidNikPattern(b) ? 200 : 120) + new Set(b).size;
      return bScore - aScore;
    });

  if (directNikCandidates[0]) {
    return directNikCandidates[0];
  }

  const candidates: string[] = [];
  const aroundNik =
    source.match(/N\s*I\s*K[^A-Z0-9]{0,8}([A-Z0-9\s:/.-]{8,42})/gi) || [];
  const numericRuns =
    source.match(/[0-9OQDBILS!][0-9OQDBILS!\s:/.-]{14,40}/g) || [];

  const pushFrom = (value: string) => {
    const digits = normalizeNik(value);
    for (let i = 0; i <= digits.length - 16; i += 1) {
      candidates.push(digits.slice(i, i + 16));
    }
  };

  if (preferredNik) {
    pushFrom(preferredNik);
  }

  aroundNik.forEach(pushFrom);
  numericRuns.forEach(pushFrom);

  const ranked = candidates
    .filter(candidate => candidate.length === 16)
    .map(candidate => {
      let score = 0;
      if (/^\d{16}$/.test(candidate)) {
        score += 40;
      }
      if (isValidNikPattern(candidate)) {
        score += 60;
      }
      score += new Set(candidate.split('')).size;
      return {candidate, score};
    })
    .sort((a, b) => b.score - a.score);

  return ranked[0]?.candidate || '';
};

const extractBestKk = (text: string) => {
  const source = String(text || '');
  const labelRegex =
    /(?:NO\.?\s*KK|NOMOR\s*KK|KARTU\s*KELUARGA|NO\.?\s*K\.?K\.?)/gi;
  const windows: string[] = [];
  let match = labelRegex.exec(source);

  while (match) {
    const start = match.index + match[0].length;
    windows.push(source.slice(start, start + 56));
    match = labelRegex.exec(source);
  }

  const firstKk = windows
    .map(item => normalizeNik(item))
    .find(candidate => candidate.length === 16);

  return firstKk || '';
};

const extractByLabel = (text: string, label: string) => {
  const lines = String(text || '')
    .split(/[\n\r]/)
    .map(item => item.trim())
    .filter(Boolean);

  const line = lines.find(item =>
    item.toUpperCase().includes(label.toUpperCase()),
  );
  if (!line) {
    return '';
  }

  const parts = line.split(':');
  if (parts.length > 1) {
    return parts.slice(1).join(':').trim();
  }

  return line.replace(new RegExp(label, 'i'), '').trim();
};

export const buildIdentityFields = (
  rawText: string,
  workerNik = '',
): IdentityFields => {
  return {
    nik: chooseBestNik(rawText, workerNik),
    kk: extractBestKk(rawText),
    name: extractByLabel(rawText, 'NAMA').toUpperCase(),
    address: extractByLabel(rawText, 'ALAMAT').toUpperCase(),
  };
};
