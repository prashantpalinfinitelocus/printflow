/** Fits the can's print area at the You2013 size the design uses. */
export const MAX_TEXT_LENGTH = 12;

/** Counts characters the way a person does, so "न" or "𝒜" is one, not two UTF-16 units. */
export const textLength = (text: string) => Array.from(text).length;

/**
 * Client-side mirror of the server's rules (PRD 6.2). The server re-checks
 * everything; this only saves a round trip for the obvious cases.
 */
export function validateText(raw: string): string | null {
  const text = raw.trim();
  if (!text) return "Add a name or a short message first.";
  if (textLength(text) > MAX_TEXT_LENGTH) return `Keep it to ${MAX_TEXT_LENGTH} characters.`;
  if (/\p{Extended_Pictographic}/u.test(text)) return "Emojis can't be printed — letters only, please.";
  // Control characters only: format characters (\p{Cf}) include the joiners Indic scripts need.
  if (/\p{Cc}/u.test(text)) return "That text has characters we can't print.";
  return null;
}

export const isValidPhone = (phone: string) => /^[6-9]\d{9}$/.test(phone);

export const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
