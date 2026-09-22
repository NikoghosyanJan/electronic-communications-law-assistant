import type { Lang } from "./language";

/** Explicit article number in the question (resolvable referent). */
const ARTICLE_NUMBER_RE =
  /(?:հոդված|article)\s*\d+|\d+\s*-?\s*րդ\s*հոդված|\d+\s*-?\s*(?:rd|th|st|nd)\s+article/i;

/**
 * Deictic reference to an article without naming which one
 * («այս հոդված», "this article", …).
 */
const DEICTIC_ARTICLE_RE =
  /(?:այս|տվյալ|սույն|նշված|վերոհիշյալ|հիշյալ)\s+հոդված|(?:this|that|the\s+(?:above|said|aforementioned|following))\s+article/i;

/**
 * True when the user refers to "this/that article" but does not name
 * an article number. Such questions must ask for clarification instead
 * of summarizing whatever retrieval returned.
 */
export function isUnderspecifiedArticleQuestion(question: string): boolean {
  const q = question.trim();
  if (!q) return false;
  if (!DEICTIC_ARTICLE_RE.test(q)) return false;
  if (ARTICLE_NUMBER_RE.test(q)) return false;
  return true;
}

export function clarificationMessage(lang: Lang): string {
  if (lang === "hy") {
    return "Խնդրում եմ նշել, թե որ հոդվածի մասին է խոսքը (օրինակ՝ Հոդված 23) կամ նշել թեման։ Առանց այդ տեղեկության չեմ կարող ամփոփել «այս հոդվածը»։";
  }
  return 'Please specify which article you mean (for example, Article 23) or name the topic. Without that, I cannot summarize "this article."';
}
