import {BoundingBox} from '../interface/ICamera';

export type MdnHelpersOptions = {
  setOcrStatus: (status: string) => void;
  MDN_OCR_WHITELIST: string;
  MDN_CHAR_CORRECTION_MAP: Record<string, string>;
  MDN_PRIMARY_REGION: BoundingBox;
};
