import { getImageProps, type StaticImageData } from "next/image";

/**
 * Preloads a photo only on the screen sizes that show it. next/image's `priority` preloads
 * for every device, so phones would fetch the web backdrop and desktops the phone hero.
 * React places the <link> in <head>; the matching <Image> stays lazy so a hidden one is never fetched.
 */
export function ImagePreload({ src, sizes, media }: { src: StaticImageData; sizes: string; media: string }) {
  const { props } = getImageProps({ src, alt: "", sizes });
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
