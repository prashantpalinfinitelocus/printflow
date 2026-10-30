import { DM_Serif_Display, Montserrat } from "next/font/google";
import localFont from "next/font/local";

/* Figma sets body copy in TCCC Unity; the web build uses Montserrat, which the
   design also uses and which Figma's own renders fall back to. */
export const sans = Montserrat({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--dc-sans" });

export const serif = DM_Serif_Display({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--dc-serif",
});

/** The face the print pipeline stamps on the can (data/fonts), so the preview matches the print. */
export const canFont = localFont({ src: "../../app/campaign/_fonts/You2013-Regular.ttf", variable: "--dc-can" });
