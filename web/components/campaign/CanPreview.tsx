import Image from "next/image";

import canBlank from "@/app/user-campaign/_assets/can-blank.png";
import { CAN_LAYOUT } from "@/lib/campaign/canImage";
import { designById } from "@/lib/campaign/designs";
import { IMAGE_QUALITY } from "@/lib/campaign/imageQuality";

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
  const design = designById(designId);
  const { name, sticker } = CAN_LAYOUT;
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
      <Image quality={IMAGE_QUALITY}
        src={design.sticker}
        alt=""
        sizes="(max-width: 480px) 30vw, 144px"
        className="absolute object-contain"
        style={{
          left: `${sticker.x * 100}%`,
          top: `${sticker.y * 100}%`,
          width: `${sticker.w * 100}%`,
          height: `${sticker.h * 100}%`,
        }}
      />
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
