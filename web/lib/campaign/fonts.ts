import { DM_Serif_Display, Montserrat } from "next/font/google";
import localFont from "next/font/local";

/*
 * Figma fonts and where each comes from:
 *   TCCC-UnityHeadline Bold (700)  → --dc-headline
 *   TCCC-UnityText                 → --dc-text: Regular (400), Medium (600) and Bold (700).
 *                                    Its 300 is TCCC-UnityHeadline Light, which Figma sets the
 *                                    input placeholders in.
 * Montserrat is what Figma's OTP popup is set in.
 */
export const text = localFont({
  src: [
    { path: "../../app/user-campaign/_fonts/TCCC-UnityHeadline-Light.ttf", weight: "300" },
    { path: "../../app/user-campaign/_fonts/TCCC-UnityText-Regular.ttf", weight: "400" },
    { path: "../../app/user-campaign/_fonts/TCCC-UnityText-Medium.ttf", weight: "600" },
    { path: "../../app/user-campaign/_fonts/TCCC-UnityText-Bold.ttf", weight: "700" },
  ],
  variable: "--dc-text",
});

export const sans = Montserrat({ subsets: ["latin"], weight: ["300", "400", "500", "600", "700"], variable: "--dc-sans" });

export const serif = DM_Serif_Display({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--dc-serif",
});

export const headline = localFont({
  src: [{ path: "../../app/user-campaign/_fonts/TCCC-UnityHeadline-Bold.ttf", weight: "700" }],
  variable: "--dc-headline",
});

/** The face the print pipeline stamps on the can (data/fonts), so the preview matches the print. */
export const canFont = localFont({ src: "../../app/user-campaign/_fonts/You2013-Regular.ttf", variable: "--dc-can" });
