import Tesseract from 'tesseract.js';

export type RecognizeOptions = NonNullable<
  Parameters<typeof Tesseract.recognize>[2]
> & {
  tessedit_pageseg_mode?: string;
  tessedit_char_whitelist?: string;
};
