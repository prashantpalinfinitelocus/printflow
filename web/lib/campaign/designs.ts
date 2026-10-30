import type { StaticImageData } from "next/image";

import arcticFriends from "@/app/user-campaign/_assets/stickers/arctic-friends.png";
import beachVibes from "@/app/user-campaign/_assets/stickers/beach-vibes.png";
import clinkingBottles from "@/app/user-campaign/_assets/stickers/clinking-bottles.png";
import discoBall from "@/app/user-campaign/_assets/stickers/disco-ball.png";
import happyBirthday from "@/app/user-campaign/_assets/stickers/happy-birthday.png";
import polarBearChill from "@/app/user-campaign/_assets/stickers/polar-bear-chill.png";
import polarBearsHeart from "@/app/user-campaign/_assets/stickers/polar-bears-heart.png";
import redRibbon from "@/app/user-campaign/_assets/stickers/red-ribbon.png";
import surfingPolarBear from "@/app/user-campaign/_assets/stickers/surfing-polar-bear.png";

export interface CanDesign {
  id: string;
  name: string;
  sticker: StaticImageData;
  /** Where Figma places the sticker inside its 115×80 picker card, in px (it may overflow and is clipped). */
  thumb: { x: number; y: number; w: number; h: number };
}

/** In the order the Figma "Pick your vibe" grid shows them (frame 243:872). */
export const DESIGNS: CanDesign[] = [
  { id: "ARCTIC_FRIENDS", name: "Arctic friends", sticker: arcticFriends, thumb: { x: 6, y: 0, w: 103, h: 79 } },
  { id: "CLINKING_BOTTLES", name: "Clinking bottles", sticker: clinkingBottles, thumb: { x: 18, y: 0, w: 79, h: 79 } },
  { id: "RED_RIBBON", name: "Red ribbon", sticker: redRibbon, thumb: { x: 2, y: -17, w: 111, h: 114 } },
  { id: "POLAR_BEARS_HEART", name: "Polar bears heart", sticker: polarBearsHeart, thumb: { x: 10, y: 0, w: 96, h: 79 } },
  { id: "HAPPY_BIRTHDAY", name: "Happy birthday", sticker: happyBirthday, thumb: { x: 18, y: 0, w: 80, h: 80 } },
  { id: "SURFING_POLAR_BEAR", name: "Surfing polar bear", sticker: surfingPolarBear, thumb: { x: 20, y: 4, w: 76, h: 73 } },
  { id: "POLAR_BEAR_CHILL", name: "Polar bear chill", sticker: polarBearChill, thumb: { x: 18, y: 0, w: 78, h: 79 } },
  { id: "BEACH_VIBES", name: "Beach vibes", sticker: beachVibes, thumb: { x: 17, y: 0, w: 80, h: 80 } },
  { id: "DISCO_BALL", name: "Disco ball", sticker: discoBall, thumb: { x: 17, y: 0, w: 80, h: 79 } },
];

export const DEFAULT_DESIGN_ID = "CLINKING_BOTTLES";

/** Unknown ids (stale session, retired design) fall back to the default rather than crash. */
export const designById = (id: string) =>
  DESIGNS.find((d) => d.id === id) ?? DESIGNS.find((d) => d.id === DEFAULT_DESIGN_ID)!;
