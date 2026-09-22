import fs from "node:fs";
import path from "node:path";

const LAW_MD = path.join(process.cwd(), "data", "law.md");
const LAW_PDF = path.join(process.cwd(), "data", "law.pdf");

/** Canonical UTF-8 law text. Prefer data/law.md; PDF is provenance only. */
export function loadLawText(): string {
  if (!fs.existsSync(LAW_MD)) {
    throw new Error(
      `Missing ${LAW_MD}. Run npm run extract-pdf first, or place a UTF-8 extract at data/law.md.`,
    );
  }
  return fs.readFileSync(LAW_MD, "utf8");
}

export function lawPaths() {
  return { lawMd: LAW_MD, lawPdf: LAW_PDF };
}

/** Strip ARLIS chrome / footers; keep article body. */
export function normalizeLawText(raw: string): string {
  let text = raw.replace(/\r\n/g, "\n");

  // Drop leading nav chrome until first chapter or article header
  const startMatch = text.match(/\*\*Գ\s*Լ\s*ՈՒ\s*Խ\s*1\*\*|\|\s*\*\*Հոդված\s+1\./);
  if (startMatch?.index != null) {
    text = text.slice(startMatch.index);
  }

  // Drop ARLIS metadata / share chrome after the presidential signature block
  const endMarkers = [
    "\nՏեղեկատվություն",
    "\nԱկտի վավերապայմաններ",
    "\nՓՈՓՈԽՈՂՆԵՐ ԵՎ ԻՆԿՈՐՊՈՐԱՑԻԱՆԵՐ",
  ];
  for (const marker of endMarkers) {
    const idx = text.indexOf(marker);
    if (idx !== -1) {
      text = text.slice(0, idx);
      break;
    }
  }

  return text.trim() + "\n";
}
