export interface ImageDimensions {
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const loadImageElement = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();

    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image source.'));
    img.src = src;
  });

export const getImageDimensions = async (
  src: string,
): Promise<ImageDimensions> => {
  const image = await loadImageElement(src);

  return {
    width: image.naturalWidth,
    height: image.naturalHeight,
  };
};
