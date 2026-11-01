import { getImageProps, type StaticImageData } from "next/image";

import { IMAGE_QUALITY } from "@/lib/campaign/imageQuality";

/**
 * Preloads a photo only on the screen sizes that show it. next/image's `priority` preloads
 * for every device, so phones would fetch the web backdrop and desktops the phone hero.
 * React places the <link> in <head>; the matching <Image> stays lazy so a hidden one is never fetched.
 */
export function ImagePreload({ src, sizes, media }: { src: StaticImageData; sizes: string; media: string }) {
  const { props } = getImageProps({ src, alt: "", sizes, quality: IMAGE_QUALITY });
  return (
    <link
      rel="preload"
      as="image"
      href={props.src}
      imageSrcSet={props.srcSet}
      imageSizes={sizes}
      media={media}
      fetchPriority="high"
    />
  );
}
