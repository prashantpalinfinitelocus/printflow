import { DM_Serif_Display, Montserrat } from "next/font/google";
import localFont from "next/font/local";

/*
 * Google and print fonts. The TCCC-UnityText and TCCC-UnityHeadline faces are declared in
 * app/user-campaign/fonts.css under their own names.
 * Montserrat is what Figma's OTP popup is set in.
 */
export const sans = Montserrat({ subsets: ["latin"], weight: ["300", "400", "500", "600", "700"], variable: "--dc-sans" });

export const serif = DM_Serif_Display({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--dc-serif",
});

/** The face the print pipeline stamps on the can (data/fonts), so the preview matches the print. */
export const canFont = localFont({ src: "../../app/user-campaign/_fonts/You2013-Regular.ttf", variable: "--dc-can" });
