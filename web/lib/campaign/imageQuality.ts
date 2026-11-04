/**
 * Next's image optimiser re-encodes at quality 75 by default, which softens the can's red type
 * and the sticker art. The campaign serves every image at full quality. Preloads must ask for the same
 * quality as the <Image>, or the browser fetches the photo twice.
 */
export const IMAGE_QUALITY = 100;

/**
 * Asked for well above the logo's size on screen: the fine "Diet" script blurs when the optimiser makes a copy
 * only just bigger than the box and the browser then rescales it. This gets 256, 384 or 640px on 1×, 2× and 3× screens.
 */
export const LOGO_SIZES = "192px";
