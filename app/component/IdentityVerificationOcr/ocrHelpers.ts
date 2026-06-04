import {createImageOcrHelpers} from './imageHelpers';
import {createMdnOcrHelpers} from './mdnHelpers';
import {createNikOcrHelpers} from './nikHelpers';
import {OcrHelpersOptions} from './type/typeOcrHelper';

export const createIdentityOcrHelpers = ({
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
}: OcrHelpersOptions) => {
  const imageHelpers = createImageOcrHelpers({
    setProgress,
    getCropAreaFromOverlay,
    visualizeCropArea,
  });

  const nikHelpers = createNikOcrHelpers({
    NIK_CHAR_MAP,
    NIK_OCR_WHITELIST,
    NIK_DYNAMIC_SCALE_HEIGHT_THRESHOLD,
    NIK_DIGIT_CORRECTION_MAP,
  });

  const mdnHelpers = createMdnOcrHelpers({
    setOcrStatus,
    MDN_OCR_WHITELIST,
    MDN_CHAR_CORRECTION_MAP,
    MDN_PRIMARY_REGION,
  });

  return {
    ...imageHelpers,
    ...nikHelpers,
    ...mdnHelpers,
  };
};
