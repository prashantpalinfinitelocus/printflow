import { DM_Serif_Display, Montserrat } from "next/font/google";
import localFont from "next/font/local";

/*
 * Figma fonts and where each comes from:
 *   TCCC-UnityHeadline Bold (700)  → --dc-headline (data/fonts)
 *   TCCC-UnityText                 → --dc-text. Regular (400), Medium (600) and Headline Light (300)
 *                                    are not supplied yet, so stand-ins from data/fonts fill those
 *                                    weights, chosen by matching Figma's text-box widths:
 *                                    Headline-Medium ≈ Text Regular (±1px), Text-Bold ≈ Text Medium (±2px).
 *                                    Replace those two paths once the real files arrive.
 * Montserrat is what Figma's OTP popup is set in.
 */
export const text = localFont({
  src: [
    { path: "../../app/user-campaign/_fonts/TCCC-UnityHeadline-Medium.ttf", weight: "300" },
    { path: "../../app/user-campaign/_fonts/TCCC-UnityHeadline-Medium.ttf", weight: "400" },
    { path: "../../app/user-campaign/_fonts/TCCC-UnityText-Bold.ttf", weight: "600" },
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
