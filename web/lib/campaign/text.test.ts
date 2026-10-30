import { describe, expect, it } from "vitest";

import { MAX_TEXT_LENGTH, isValidEmail, isValidPhone, textLength, validateText } from "./text";

describe("textLength", () => {
  it("counts a Devanagari name by code points, not UTF-16 units", () => {
    expect(textLength("राम")).toBe(3);
  });

  it("counts an astral-plane character as one", () => {
    expect(textLength("𝒜b")).toBe(2);
  });
});

describe("validateText", () => {
  it("accepts a plain name", () => {
    expect(validateText("Aanya")).toBeNull();
  });

  it("rejects empty and whitespace-only text", () => {
    expect(validateText("   ")).toMatch(/add a name/i);
  });

  it("measures length after trimming, so padding does not count", () => {
    expect(validateText(`  ${"a".repeat(MAX_TEXT_LENGTH)}  `)).toBeNull();
  });

  it(`rejects text longer than ${MAX_TEXT_LENGTH} characters`, () => {
    expect(validateText("a".repeat(MAX_TEXT_LENGTH + 1))).toMatch(/12 characters/);
  });

  it("rejects emoji, which the print workflow cannot reproduce", () => {
    expect(validateText("Hi 🎉")).toMatch(/emoji/i);
  });

  it("rejects control characters", () => {
    expect(validateText("Ann\u0007a")).toMatch(/can.t print/i);
  });

  it("accepts multilingual text", () => {
    expect(validateText("प्रिया")).toBeNull();
  });

  it("accepts the zero-width joiner Indic scripts use to shape conjuncts", () => {
    expect(validateText("क्‍ष")).toBeNull();
  });

  it("accepts the zero-width non-joiner as well", () => {
    expect(validateText("क्‌ष")).toBeNull();
  });

  it("accepts digits and everyday punctuation", () => {
    expect(validateText("Riya's bday!")).toBeNull();
    expect(validateText("No. 1 Mom")).toBeNull();
  });

  it.each([
    ["a zero-width space hiding a word", "stu​pid"],
    ["a right-to-left override", "‮Aanya"],
    ["a line separator", "Aa nya"],
    ["a private-use character", "Aanya"],
  ])("rejects %s as unprintable", (_case, text) => {
    expect(validateText(text)).toMatch(/can.t print/i);
  });

  it.each([
    ["a flag", "India 🇮🇳"],
    ["a keycap", "No 1️⃣"],
  ])("rejects %s as an emoji", (_case, text) => {
    expect(validateText(text)).toMatch(/emoji/i);
  });

  it("rejects trademark-style symbols without calling them emoji", () => {
    expect(validateText("Coke™")).toMatch(/can.t print/i);
  });
});

describe("isValidPhone", () => {
  it("accepts a 10-digit Indian mobile number", () => {
    expect(isValidPhone("9876543210")).toBe(true);
  });

  it("rejects numbers that do not start with 6-9", () => {
    expect(isValidPhone("1234567890")).toBe(false);
  });

  it("rejects the wrong length", () => {
    expect(isValidPhone("987654321")).toBe(false);
  });
});

describe("isValidEmail", () => {
  it("accepts a normal address, ignoring surrounding spaces", () => {
    expect(isValidEmail(" aanya@example.com ")).toBe(true);
  });

  it("rejects an address without a domain dot", () => {
    expect(isValidEmail("aanya@example")).toBe(false);
  });

  it("rejects an address without @", () => {
    expect(isValidEmail("aanya.example.com")).toBe(false);
  });
});
