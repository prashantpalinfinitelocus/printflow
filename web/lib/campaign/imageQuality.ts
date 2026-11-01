/**
 * Next's image optimiser re-encodes at quality 75 by default, which softens the can's red type
 * and the sticker art. The campaign serves every image at 90. Preloads must ask for the same
 * quality as the <Image>, or the browser fetches the photo twice.
 */
export const IMAGE_QUALITY = 90;
