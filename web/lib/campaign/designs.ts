import type { StaticImageData } from "next/image";

import arcticFriends from "@/app/campaign/_assets/stickers/arctic-friends.png";
import beachVibes from "@/app/campaign/_assets/stickers/beach-vibes.png";
import clinkingBottles from "@/app/campaign/_assets/stickers/clinking-bottles.png";
import discoBall from "@/app/campaign/_assets/stickers/disco-ball.png";
import happyBirthday from "@/app/campaign/_assets/stickers/happy-birthday.png";
import polarBearChill from "@/app/campaign/_assets/stickers/polar-bear-chill.png";
import polarBearsHeart from "@/app/campaign/_assets/stickers/polar-bears-heart.png";
import redRibbon from "@/app/campaign/_assets/stickers/red-ribbon.png";
import surfingPolarBear from "@/app/campaign/_assets/stickers/surfing-polar-bear.png";

export interface CanDesign {
  id: string;
  name: string;
  sticker: StaticImageData;
}

/** In the order the Figma "Pick your vibe" grid shows them. */
export const DESIGNS: CanDesign[] = [
  { id: "ARCTIC_FRIENDS", name: "Arctic friends", sticker: arcticFriends },
  { id: "CLINKING_BOTTLES", name: "Clinking bottles", sticker: clinkingBottles },
  { id: "RED_RIBBON", name: "Red ribbon", sticker: redRibbon },
  { id: "POLAR_BEARS_HEART", name: "Polar bears heart", sticker: polarBearsHeart },
  { id: "HAPPY_BIRTHDAY", name: "Happy birthday", sticker: happyBirthday },
  { id: "SURFING_POLAR_BEAR", name: "Surfing polar bear", sticker: surfingPolarBear },
  { id: "POLAR_BEAR_CHILL", name: "Polar bear chill", sticker: polarBearChill },
  { id: "BEACH_VIBES", name: "Beach vibes", sticker: beachVibes },
  { id: "DISCO_BALL", name: "Disco ball", sticker: discoBall },
];

export const DEFAULT_DESIGN_ID = "CLINKING_BOTTLES";

/** Unknown ids (stale session, retired design) fall back to the default rather than crash. */
export const designById = (id: string) =>
  DESIGNS.find((d) => d.id === id) ?? DESIGNS.find((d) => d.id === DEFAULT_DESIGN_ID)!;
