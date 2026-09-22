/**
 * One-shot PDF → data/law.md extract.
 *
 * Prefer the committed ARLIS-structured data/law.md when present — PDF text
 * layers from ARLIS exports are often noisy. Use --force to overwrite.
 *
 * Usage: npm run extract-pdf [-- --force] [-- --out=data/law.md]
 */
import fs from "node:fs";
import path from "node:path";
import { extractText, getDocumentProxy } from "unpdf";

const ROOT = process.cwd();
const PDF_PATH = path.join(ROOT, "data", "law.pdf");
const DEFAULT_OUT = path.join(ROOT, "data", "law.md");

const SOURCE_HEADER = `Source URL: https://www.arlis.am/hy/acts/1869
Title: ՀՀ ՕՐԵՆՔԸ ԷԼԵԿՏՐՈՆԱՅԻՆ ՀԱՂՈՐԴԱԿՑՈՒԹՅԱՆ ՄԱՍԻՆ
Extracted from: data/law.pdf
`;

function parseArgs(argv: string[]) {
  const force = argv.includes("--force");
  const outArg = argv.find((a) => a.startsWith("--out="));
  const out = outArg ? path.resolve(ROOT, outArg.slice("--out=".length)) : DEFAULT_OUT;
  return { force, out };
}

function countArticleMentions(text: string): number {
  const nums = new Set<number>();
  for (const m of text.matchAll(/Հոդված\s+(\d+)/g)) {
    nums.add(Number(m[1]));
  }
  return nums.size;
}

async function main() {
  const { force, out } = parseArgs(process.argv.slice(2));

  if (!fs.existsSync(PDF_PATH)) {
    throw new Error(`Missing ${PDF_PATH}`);
  }

  if (fs.existsSync(out) && !force && out === DEFAULT_OUT) {
    console.log(
      `Keeping existing ${path.relative(ROOT, out)} (structured ARLIS extract).\n` +
        `Re-run with --force to overwrite from PDF, or --out=data/law.pdf.extract.txt to write a side file.`,
    );
    return;
  }

  console.log(`Reading ${path.relative(ROOT, PDF_PATH)}…`);
  const buffer = fs.readFileSync(PDF_PATH);
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { totalPages, text } = await extractText(pdf, { mergePages: true });
  const body = String(text ?? "").trim();

  if (!body || body.length < 1000) {
    throw new Error(
      `PDF text layer looks empty/unreliable (${body.length} chars, ${totalPages} pages). ` +
        `Keep or restore the committed data/law.md instead.`,
    );
  }

  const uniqueArticles = countArticleMentions(body);
  console.log(`Pages: ${totalPages}, chars: ${body.length}, unique Հոդված N: ${uniqueArticles}`);

  if (uniqueArticles < 50) {
    throw new Error(
      `Only found ${uniqueArticles} article mentions — expected ~60+. Refusing to write ${out}.`,
    );
  }

  const content = `${SOURCE_HEADER}\n${body}\n`;
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, content, "utf8");
  console.log(`Wrote ${path.relative(ROOT, out)}`);

  if (uniqueArticles < 60) {
    console.warn(
      `Warning: article count (${uniqueArticles}) is a bit low; verify parse with npm run ingest -- --dry-run`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
