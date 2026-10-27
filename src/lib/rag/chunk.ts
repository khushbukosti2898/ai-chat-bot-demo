// Stage 3: Chunking
// Each profile splits differently:
//   narrative  - pages are stitched into one stream first, so a paragraph that runs across a
//                page break stays whole; then recursive paragraph/sentence splitting.
//   structured - every page is assigned to its outline section (chapter > region/box), each
//                section is split on its own so no chunk straddles two sections, and every
//                chunk carries its section breadcrumb (also embedded, so "South Asia" in the
//                question matches chunks from the South Asia section, not just any growth text).
//   visual     - one chunk per extracted element (table, chart, callout...). Footnotes cited
//                by an element are appended to it, so the caveat travels with the number.
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import type { ElementKind, OutlineEntry, ParsedFile, VisualElement } from "./parse";
import { chunkSettings, type Profile } from "./profiles";

export type Chunk = {
  id: number;
  text: string; // what the LLM reads
  embedText: string; // what gets embedded and keyword-indexed (text + location context)
  page: number;
  pageEnd: number;
  section: string; // breadcrumb, e.g. "Ch. 2 Regional Outlooks > South Asia"
  chapter: string; // top-level section title, used for "Chapter 3" style filters
  kind: ElementKind;
};

type PageText = { page: number; text: string };
type Piece = { text: string; page: number; pageEnd: number };

export async function chunkDocument(profile: Profile, parsed: ParsedFile, elements: VisualElement[] = []): Promise<Chunk[]> {
  const pieces =
    profile === "visual" && elements.length > 0
      ? await chunkVisual(elements)
      : profile === "structured" && parsed.outline.length > 0
        ? await chunkStructured(parsed)
        : await chunkNarrative(parsed);
  return pieces.map((c, i) => ({ ...c, id: i + 1 }));
}

// Split a run of pages, remembering which page each piece starts and ends on.
async function splitWithPages(pages: PageText[], profile: Profile): Promise<Piece[]> {
  const splitter = new RecursiveCharacterTextSplitter(chunkSettings[profile]);
  const starts: number[] = [];
  let full = "";
  for (const p of pages) {
    starts.push(full.length);
    full += p.text + "\n\n";
  }
  const pageAt = (offset: number) => {
    let i = 0;
    while (i + 1 < starts.length && starts[i + 1] <= offset) i++;
    return pages[i].page;
  };

  const pieces: Piece[] = [];
  let cursor = 0;
  for (const text of await splitter.splitText(full)) {
    const at = full.indexOf(text, cursor);
    const start = at === -1 ? cursor : at;
    pieces.push({ text, page: pageAt(start), pageEnd: pageAt(start + text.length - 1) });
    cursor = start + 1;
  }
  return pieces;
}

// ---- narrative --------------------------------------------------------------
async function chunkNarrative(parsed: ParsedFile): Promise<Omit<Chunk, "id">[]> {
  const pages = parsed.pages.map((text, i) => ({ page: i + 1, text })).filter((p) => p.text.trim());
  return (await splitWithPages(pages, "narrative")).map((p) => ({
    ...p,
    embedText: p.text,
    section: "",
    chapter: "",
    kind: "text",
  }));
}

// ---- structured -------------------------------------------------------------
type Section = { title: string; start: number; nested: boolean; parent?: Section; box?: string };

const SKIP_SECTIONS = /^(summary of )?contents$/i; // tables of contents mention every topic: pure noise

function buildSections(parsed: ParsedFile): Section[] {
  // Outline titles sometimes wrap into two bookmarks ("Middle East, North Africa," + "-- Afghanistan, and Pakistan").
  // Merge in outline order (the first half may have no page), then sort by page.
  const entries: OutlineEntry[] = [];
  for (const e of parsed.outline) {
    const prev = entries.at(-1);
    if (prev && prev.title.endsWith(",")) {
      const marker = e.title.startsWith("--") && !prev.title.startsWith("--") ? "-- " : "";
      prev.title = `${marker}${prev.title} ${e.title.replace(/^-+\s*/, "")}`;
      prev.page = prev.page || e.page;
    } else entries.push({ ...e });
  }

  const sections: Section[] = [];
  let top: Section | undefined;
  for (const e of entries.filter((x) => x.page > 0).sort((a, b) => a.page - b.page)) {
    // "--" marks a sub-section in this outline, sometimes mid-title after a line wrap.
    const title = e.title.replace(/\s*--\s*/g, " ").trim();
    const box = title.match(/^box\s+(\d+\.\d+)/i)?.[1];
    const nested = e.depth > 0 || Boolean(box) || e.title.includes("--");
    const section: Section = {
      title,
      start: fixStartPage(parsed.pages, title, e.page),
      nested: nested && Boolean(top),
      parent: nested ? top : undefined,
      box,
    };
    if (!section.nested) top = section;
    sections.push(section);
  }
  return sections.sort((a, b) => a.start - b.start);
}

// Bookmarks sometimes point at the page before the heading actually appears.
function fixStartPage(pages: string[], title: string, page: number): number {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
  const needle = norm(title).slice(0, 20);
  const on = (p: number) => norm(pages[p - 1] ?? "").includes(needle);
  return !on(page) && on(page + 1) ? page + 1 : page;
}

function sectionForPage(sections: Section[], page: number, pageText: string): Section | undefined {
  const active = sections.filter((s) => s.start <= page);
  for (let i = active.length - 1; i >= 0; i--) {
    const s = active[i];
    // A box spans only the pages that still carry its "Box 1.1" label; after that the
    // surrounding chapter text resumes.
    if (s.box && page > s.start && !new RegExp(`box\\s*${s.box.replace(".", "\\.")}`, "i").test(pageText)) continue;
    return s;
  }
  return undefined;
}

const breadcrumb = (s: Section) => (s.parent ? `${s.parent.title} > ${s.title}` : s.title);

async function chunkStructured(parsed: ParsedFile): Promise<Omit<Chunk, "id">[]> {
  const sections = buildSections(parsed);

  // Group consecutive pages that belong to the same section.
  const runs: { section?: Section; pages: PageText[] }[] = [];
  parsed.pages.forEach((text, i) => {
    const section = sectionForPage(sections, i + 1, text);
    const last = runs.at(-1);
    if (last && last.section === section) last.pages.push({ page: i + 1, text });
    else runs.push({ section, pages: [{ page: i + 1, text }] });
  });

  const chunks: Omit<Chunk, "id">[] = [];
  for (const run of runs) {
    const title = run.section ? breadcrumb(run.section) : "Front matter";
    const chapter = run.section ? (run.section.parent ?? run.section).title : "Front matter";
    if (SKIP_SECTIONS.test(chapter)) continue;
    const pages = run.pages.filter((p) => p.text.trim());
    if (pages.length === 0) continue;
    for (const piece of await splitWithPages(pages, "structured")) {
      chunks.push({ ...piece, embedText: `Section: ${title}\n${piece.text}`, section: title, chapter, kind: "text" });
    }
  }
  return chunks;
}

// ---- visual -----------------------------------------------------------------
async function chunkVisual(elements: VisualElement[]): Promise<Omit<Chunk, "id">[]> {
  const notes = new Map<number, string>();
  for (const el of elements) if (el.kind === "footnote") for (const n of el.footnotes) notes.set(n, el.content);

  const splitter = new RecursiveCharacterTextSplitter(chunkSettings.visual);
  const chunks: Omit<Chunk, "id">[] = [];
  for (const el of elements) {
    if (!el.content.trim()) continue;
    const cited =
      el.kind === "footnote"
        ? ""
        : el.footnotes
            .filter((n) => notes.has(n))
            .map((n) => `[${n}] ${notes.get(n)}`)
            .join("\n");
    const body = `${el.title}\n${el.content}${cited ? `\nFootnotes:\n${cited}` : ""}`;
    // Tables and charts stay whole even if long: splitting a table separates numbers from headers.
    const parts = el.kind === "table" || el.kind === "chart" ? [body] : await splitter.splitText(body);
    for (const text of parts) {
      chunks.push({
        text,
        embedText: `[${el.kind}] ${text}`,
        page: el.page,
        pageEnd: el.page,
        section: el.title,
        chapter: "",
        kind: el.kind,
      });
    }
  }
  return chunks;
}
