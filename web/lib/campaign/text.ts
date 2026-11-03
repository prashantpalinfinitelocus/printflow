/** Fits the can's print area at the You2013 size the design uses. */
export const MAX_TEXT_LENGTH = 12;

/**
 * Counts Unicode code points, so "𝒜" is one, not two UTF-16 units. Indic vowel
 * signs and viramas count separately ("प्रिया" is 6); the server must count the same way.
 */
export const textLength = (text: string) => Array.from(text).length;

/** Emoji, including flags (regional indicators) and keycaps (U+20E3), which are not Extended_Pictographic. */
const EMOJI = /\p{Regional_Indicator}|\u20E3|\p{Extended_Pictographic}/u;

/**
 * Everything printable: letters, combining marks, digits, spaces, punctuation, and
 * the ZWNJ/ZWJ joiners Indic scripts shape with. An allowlist, so invisible or
 * direction-changing characters (zero-width space, RTL override) can't hide a word
 * from moderation.
 */
const PRINTABLE = /^[\p{L}\p{M}\p{N}\p{Zs}\p{P}\u200C\u200D]+$/u;

/** Marks \p{M} lets in that print nothing: the variation selectors (invisible, so they could hide a word). */
const HIDDEN_MARKS = /[\uFE00-\uFE0F\u{E0100}-\u{E01EF}]/u;

/** ©, ® and ™ are Extended_Pictographic, but people don't think of them as emoji. */
const LEGAL_SYMBOLS = /[©®™]/u;

const TEXT_PROBLEMS = {
  empty: "Add a name or a short message first.",
  too_long: `Keep it to ${MAX_TEXT_LENGTH} characters.`,
  emoji: "Emojis can't be printed — letters only, please.",
  unprintable: "That text has characters we can't print.",
};

/**
 * Client-side mirror of the server's rules (PRD 6.2). The server re-checks
 * everything; this only saves a round trip for the obvious cases.
 */
export function textProblem(raw: string): keyof typeof TEXT_PROBLEMS | null {
  const text = raw.trim();
  if (!text) return "empty";
  if (textLength(text) > MAX_TEXT_LENGTH) return "too_long";
  if (!LEGAL_SYMBOLS.test(text) && EMOJI.test(text)) return "emoji";
  if (!PRINTABLE.test(text) || HIDDEN_MARKS.test(text)) return "unprintable";
  return null;
}

/** What to tell the user about `raw`, or null when it passes. */
export function validateText(raw: string): string | null {
  const problem = textProblem(raw);
  return problem && TEXT_PROBLEMS[problem];
}

export const isValidPhone = (phone: string) => /^[6-9]\d{9}$/.test(phone);

export const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
