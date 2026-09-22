export type Lang = "hy" | "en" | "other";

const ARMENIAN_RE = /[\u0531-\u0556\u0561-\u0587]/;

export function detectLanguage(text: string): Lang {
  if (ARMENIAN_RE.test(text)) return "hy";
  // Latin-heavy → treat as English for retrieve/answer language
  if (/[A-Za-z]{3,}/.test(text)) return "en";
  return "other";
}

export function answerLanguageInstruction(lang: Lang): string {
  if (lang === "hy") {
    return "Answer in Armenian (հայերեն).";
  }
  if (lang === "en") {
    return "Answer in English.";
  }
  return "Answer in the same language as the user question.";
}
