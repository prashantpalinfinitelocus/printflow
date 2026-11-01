# Design QA — Diet Coke campaign (live test env)

- **Date:** 2026-11-01
- **Env:** https://diet-coke-test.coke2home.com/user-campaign
- **Design:** Figma `Custom-Diet-Coke_`, page "Design" (node 128:214)
- **Viewports:** mWeb 390×844 at DPR 1 and 3; web 1440×900 at DPR 1 and 2; also 1280, 1024, 768
- **Flow:** landing → login → OTP → heads-up → create → moderation → preview → download → submit → success,
  plus empty submit, invalid number, invalid email, T&C unticked, wrong OTP, profanity, empty text, over 12 characters

The pixel-by-pixel Figma diff is not done yet. The Figma API rate-limited the shared token (View/Collab seat,
about 60 hours), so the live site was checked against itself and against the Figma node references in the code.

## Fixed on `feat/diet-coke-campaign` (not yet deployed)

| ID | Issue | Fix |
|---|---|---|
| QA-01 | Text that moderation turned down (live check, Check my vibe, or the server at submit) still showed on the can, so a profane word could be screenshotted on the product. | `create/page.tsx` passes no text to `CanPreview` while the text is flagged. Clean text shows again as soon as it's edited. |
| QA-08 | Web: the placeholder was cut off as "Your name or a short r" under the arrow button (370px of text in a 289px field at 24px). | Placeholder is 16px on web (265px). Typed text stays 24px. |
| QA-10 | "I Agree to Diet cokes’" | "I agree to Diet Coke’s" |
| QA-10 | "If you win you receive an email soon." | "If you win, you’ll receive an email soon." |
| QA-10 | "Max character allowed 0/12" | "Max characters allowed 0/12" |

Verified with unit tests (260/260 pass, `tsc` clean) and in Chromium on the local server at 1440 and 390.
The moderation response was stubbed to REJECTED because the local backend approves everything.

## Built to Figma — design to decide, no dev change

The code cites a Figma frame for each of these, so they match the design. Raise them with design if they
should change.

| ID | What QA saw | Code / Figma reference |
|---|---|---|
| QA-02 | Web success shows two logos; the top-right one sits on the dark cola glass with low contrast. | `success/page.tsx`: "Figma shows two logos… top right over the glass" (356:1102) |
| QA-03 | Web landing: the top hand ends in a hard vertical edge (x≈82 at 1440, 73 at 1280, 46 at 768). | `Landing.tsx`: cut-out "at x 82" (356:1307). The hand is cut in the `web-hands.png` asset itself. |
| QA-06 | An invalid mobile number doesn't turn the field red; an invalid email does. | `LoginFlow.tsx`: "Figma keeps this border grey on a phone error" |
| QA-07 | After a wrong OTP, the "Resend in 00:29" line is hidden. | Wrong-code state, Figma 346:2 |
| QA-09 | Modals use Montserrat; the Verify button is TCCC-UnityText. | `fonts.ts` / `LoginFlow.tsx`: "Figma sets the popup in Montserrat but this button in TCCC-UnityText Medium" |
| QA-11 | A rejection shows the inline live-check message and the "Let's keep it friendly" popup together. | Popup is Figma 243:1013; the inline message is the live-check feature |

## Needs new assets from design

The source files are smaller than the screens they cover, so code can't make them sharper. Ratio = pixels
served ÷ pixels the screen needs.

| Asset | Screen | Source | Needed | Ratio | Ask |
|---|---|---|---|---|---|
| `web-bg.jpg` (48 KB) | Web landing @2x | 1672×941 | 4334 wide | 0.39× | 3840+ wide, quality 80+ |
| `web-success-bg.jpg` | Web success @2x | 1672×941 | 3344 wide | 0.50× | 3344+ wide |
| `success-bg.png` | mWeb success @3x | 907×1733 | 1334 wide | 0.68× | 1400+ wide |
| `web-hands.png` | Web landing @2x | 1241×1512 | 1715 wide | 0.72× | 1800+ wide, hand not cut at the left |
| `hero.png` | mWeb landing @3x | 941×1671 | 1170 wide | 0.80× | 1200+ wide |

Logo, can, stickers and the generated preview are sharp at every density.

## Open copy and design questions

Probably copied as-is from Figma; change only with design/brand sign-off.

- "Your entry is in.." (double full stop)
- "10AM / 10PM" → "10 AM / 10 PM"?
- "your email ID" is lower case; "Your mobile number" is capitalised
- Profanity popup: "…didn’t make the cut, let’s change it and try again" (comma splice, no full stop)
- Button casing mixes Title Case ("Make It Happen", "Let’s Do This", "Edit Text") and sentence case ("Check my vibe")
- Preview: the name on the can is small (≈5% of can width) compared with the landing hero
- Success: no next action (home, share or create another)

## Withdrawn

- **QA-12** "Sticker tiles have no accessible name": wrong. Each tile button has `aria-label` with the design
  name; only the inner decorative `<img>` has empty alt, which is correct.

## Other notes

- The generated preview PNG is 2.3 MB (932×2304). It is the server's export, which is also the download.
  A lighter display copy would speed up the preview on 4G.
- The local mock's moderation word list (`api.ts` `BLOCKED`) has no strong profanity. The real server flags it.
