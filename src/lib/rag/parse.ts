// Stage 1-2: Upload -> Parsing
// Turn an uploaded file into clean page text plus whatever structure the file carries:
//   - every PDF: one cleaned text string per page (running headers/footers removed)
//   - structured PDFs: the PDF outline (bookmarks) = chapter/section titles + start pages
//   - visual PDFs: Gemini reads each page as an image-like document and returns typed
//     elements (table / chart / callout / footnote / text), because plain text extraction
//     scrambles chart labels and loses numbers that only exist in the graphics.
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { HumanMessage } from "@langchain/core/messages";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { extractText, getDocumentProxy } from "unpdf";
import { config } from "./config";
import { getText } from "./text";

export type OutlineEntry = { title: string; page: number; depth: number };
export type ParsedFile = { pages: string[]; outline: OutlineEntry[] };

export type ElementKind = "text" | "table" | "chart" | "callout" | "footnote";
export type VisualElement = {
  page: number;
  kind: ElementKind;
  title: string;
  content: string;
  // Footnote numbers this element cites (superscripts), or its own number for a footnote.
  footnotes: number[];
};

export async function parseFile(buffer: Buffer, filename: string): Promise<ParsedFile> {
  const ext = filename.toLowerCase().split(".").pop();

  if (ext === "pdf") {
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await extractText(pdf, { mergePages: false });
    return { pages: removeRunningHeaders(text), outline: await readOutline(pdf) };
  }

  if (ext === "txt" || ext === "md") {
    return { pages: [buffer.toString("utf-8")], outline: [] };
  }

  throw new Error(`Unsupported file type ".${ext}". Upload a .pdf, .txt or .md file.`);
}

// ---- Header / footer cleanup ---------------------------------------------
// Report PDFs repeat a running header on every page ("C H A P T E R 2 G L O B A L ...").
// Left in, it pollutes every chunk and every embedding with the same noise.
const isLetterSpaced = (line: string) => {
  const tokens = line.trim().split(/\s+/);
  return tokens.length >= 8 && tokens.filter((t) => t.length === 1).length / tokens.length > 0.6;
};
const normalizeLine = (line: string) => line.trim().replace(/\d+/g, "#");

function removeRunningHeaders(pages: string[]): string[] {
  const seenOn = new Map<string, number>();
  for (const page of pages) {
    for (const line of new Set(page.split("\n").map(normalizeLine))) {
      if (line) seenOn.set(line, (seenOn.get(line) ?? 0) + 1);
    }
  }
  // A short line found on a quarter of all pages is a header/footer, not content.
  const threshold = Math.max(3, Math.ceil(pages.length * 0.25));
  return pages.map((page) =>
    page
      .split("\n")
      .filter((line) => {
        const norm = normalizeLine(line);
        if (isLetterSpaced(line)) return false;
        return !(norm.length < 80 && (seenOn.get(norm) ?? 0) >= threshold);
      })
      .join("\n")
      .trim(),
  );
}

// ---- PDF outline (bookmarks) ----------------------------------------------
type PdfProxy = Awaited<ReturnType<typeof getDocumentProxy>>;
type OutlineNode = { title: string; dest: unknown; items?: OutlineNode[] };

async function readOutline(pdf: PdfProxy): Promise<OutlineEntry[]> {
  const entries: OutlineEntry[] = [];
  const walk = async (items: OutlineNode[] | null | undefined, depth: number) => {
    for (const item of items ?? []) {
      try {
        const dest = typeof item.dest === "string" ? await pdf.getDestination(item.dest) : item.dest;
        // A bookmark without a target is kept (page 0): it can be the first half of a wrapped title.
        const page = Array.isArray(dest) ? (await pdf.getPageIndex(dest[0])) + 1 : 0;
        entries.push({ title: item.title.replace(/\s+/g, " ").trim(), page, depth });
      } catch {
        // Broken bookmark: skip it, the rest of the outline is still useful.
      }
      await walk(item.items, depth + 1);
    }
  };
  await walk((await pdf.getOutline()) as OutlineNode[] | null, 0);
  return entries;
}

// ---- Visual parsing with Gemini -------------------------------------------
const VISUAL_PROMPT = `You are extracting facts from page {page} of the attached PDF so they can be searched later.
Look at the page as a human reader would, including charts, diagrams, icons and small print.

Return ONLY a JSON array. One object per distinct element on page {page}:
{"kind": "text" | "table" | "chart" | "callout" | "footnote", "title": string, "content": string, "footnotes": number[]}

Rules:
- "table": rewrite as a Markdown table with every row, column header and unit.
- "chart": name the chart, then list EVERY labelled value with its label and unit, and any shares
  or percentages shown. State what the bars/segments represent. Do not estimate unlabelled values.
- "callout": icon or highlight boxes such as "100% recycled aluminum in the stand"; keep the exact wording.
- "footnote": one object per numbered note at the bottom of the page or in a notes list;
  "footnotes" holds its own number, "content" its full text.
- "text": body paragraphs, grouped by heading.
- For every other element, "footnotes" lists the superscript footnote numbers it cites.
- Copy numbers exactly as printed. Do not add information that is not on the page.
- "title" is a short heading for the element (use the heading printed on the page if there is one).`;

const PROMPT_VERSION = "v1";

export async function parseVisual(buffer: Buffer, pageCount: number): Promise<VisualElement[]> {
  const hash = crypto.createHash("sha1").update(buffer).update(config.visionModel + PROMPT_VERSION).digest("hex");
  const cachePath = path.join(config.dataDir, "parsed", `${hash}.json`);
  try {
    return JSON.parse(await fs.readFile(cachePath, "utf-8")) as VisualElement[];
  } catch {
    // Not parsed yet.
  }

  const llm = new ChatGoogleGenerativeAI({ model: config.visionModel, temperature: 0 });
  const data = buffer.toString("base64");
  const elements: VisualElement[] = [];

  // One call per page keeps each answer focused and short enough not to be truncated.
  for (let page = 1; page <= pageCount; page++) {
    const response = await llm.invoke([
      new HumanMessage({
        content: [
          { type: "media", mimeType: "application/pdf", data },
          { type: "text", text: VISUAL_PROMPT.replaceAll("{page}", String(page)) },
        ],
      }),
    ]);
    for (const el of parseJsonArray(getText(response.content))) {
      elements.push({
        page,
        kind: (["text", "table", "chart", "callout", "footnote"].includes(String(el.kind)) ? el.kind : "text") as ElementKind,
        title: String(el.title ?? ""),
        content: String(el.content ?? ""),
        footnotes: Array.isArray(el.footnotes) ? el.footnotes.map(Number).filter(Number.isFinite) : [],
      });
    }
  }

  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  await fs.writeFile(cachePath, JSON.stringify(elements, null, 2));
  return elements;
}

type RawElement = { kind?: string; title?: unknown; content?: unknown; footnotes?: unknown[] };

function parseJsonArray(text: string): RawElement[] {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1) return [];
  try {
    return JSON.parse(text.slice(start, end + 1)) as RawElement[];
  } catch {
    return [];
  }
}
