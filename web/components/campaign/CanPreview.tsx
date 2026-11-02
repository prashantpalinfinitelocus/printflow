"use client";

import Image from "next/image";

import canBlank from "@/app/user-campaign/_assets/can-blank.png";
import { CAN_LAYOUT } from "@/lib/campaign/canImage";
import { IMAGE_QUALITY } from "@/lib/campaign/imageQuality";
import { useDesigns } from "@/lib/campaign/useDesigns";

/**
 * The can as three layers — blank can, sticker, name — placed with the
 * fractions in CAN_LAYOUT, so it scales to any width and matches the PNG export.
 */
export function CanPreview({
  designId,
  text,
  className = "",
  priority,
}: {
  designId: string;
  text: string;
  className?: string;
  priority?: boolean;
}) {
  const design = useDesigns().find(designId);
  const { name, sticker } = CAN_LAYOUT;
  const stickerBox = {
    left: `${sticker.x * 100}%`,
    top: `${sticker.y * 100}%`,
    width: `${sticker.w * 100}%`,
    height: `${sticker.h * 100}%`,
  };
  return (
    <div
      role="img"
      aria-label={
        text ? `Diet Coke can with ${design.name} art and the text ${text}` : `Diet Coke can with ${design.name} art`
      }
      className={`relative [container-type:inline-size] ${className}`}
      style={{ aspectRatio: `${canBlank.width} / ${canBlank.height}` }}
    >
      <Image quality={IMAGE_QUALITY} src={canBlank} alt="" fill priority={priority} sizes="(max-width: 480px) 50vw, 240px" className="object-contain" />
      {typeof design.sticker === "string" ? (
        // An uploaded sticker: already re-saved and shrunk by the API, so it is shown as it is.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={design.sticker} alt="" className="absolute object-contain" style={stickerBox} />
      ) : (
        <Image
          quality={IMAGE_QUALITY}
          src={design.sticker}
          alt=""
          sizes="(max-width: 480px) 30vw, 144px"
          className="absolute object-contain"
          style={stickerBox}
        />
      )}
      {text && (
        <span
          className="absolute inset-x-0 text-center leading-none whitespace-nowrap"
          style={{
            top: `${name.y * 100}%`,
            fontFamily: "var(--dc-can)",
            fontSize: `${name.size * 100}cqw`,
            letterSpacing: `${name.tracking}em`,
            color: name.color,
          }}
        >
          {text.toUpperCase()}
        </span>
      )}
    </div>
  );
}
