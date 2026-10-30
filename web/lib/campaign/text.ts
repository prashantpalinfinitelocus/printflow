/** Fits the can's print area at the You2013 size the design uses. */
export const MAX_TEXT_LENGTH = 12;

/**
 * Counts Unicode code points, so "𝒜" is one, not two UTF-16 units. Indic vowel
 * signs and viramas count separately ("प्रिया" is 6); the server must count the same way.
 */
export const textLength = (text: string) => Array.from(text).length;

/** Emoji, including flags (regional indicators) and keycaps (U+20E3), which are not Extended_Pictographic. */
const EMOJI = /\p{Regional_Indicator}|⃣|\p{Extended_Pictographic}/u;

/**
 * Everything printable: letters, combining marks, digits, spaces, punctuation, and
 * the ZWNJ/ZWJ joiners Indic scripts shape with. An allowlist, so invisible or
 * direction-changing characters (zero-width space, RTL override) can't hide a word
 * from moderation.
 */
const PRINTABLE = /^[\p{L}\p{M}\p{N}\p{Zs}\p{P}‌‍]+$/u;

/** ©, ® and ™ are Extended_Pictographic, but people don't think of them as emoji. */
const LEGAL_SYMBOLS = /[©®™]/u;

/**
 * Client-side mirror of the server's rules (PRD 6.2). The server re-checks
 * everything; this only saves a round trip for the obvious cases.
 */
export function validateText(raw: string): string | null {
  const text = raw.trim();
  if (!text) return "Add a name or a short message first.";
  if (textLength(text) > MAX_TEXT_LENGTH) return `Keep it to ${MAX_TEXT_LENGTH} characters.`;
  if (!LEGAL_SYMBOLS.test(text) && EMOJI.test(text)) return "Emojis can't be printed — letters only, please.";
  if (!PRINTABLE.test(text)) return "That text has characters we can't print.";
  return null;
}

export const isValidPhone = (phone: string) => /^[6-9]\d{9}$/.test(phone);

export const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
