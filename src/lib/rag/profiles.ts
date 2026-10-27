// Document profiles: the same pipeline, tuned differently per document shape.
//   narrative  - plain paragraphs with facts inside sentences (GPO annual report)
//   structured - long report with chapters/sections in the PDF outline (World Bank GEP)
//   visual     - short report whose facts live in charts, tables, icons, footnotes (Apple PER)
export type Profile = "narrative" | "structured" | "visual";

export const PROFILES: Profile[] = ["narrative", "structured", "visual"];

export const chunkSettings: Record<Profile, { chunkSize: number; chunkOverlap: number }> = {
  // Medium chunks: one or two paragraphs, enough for a fact plus the sentence that frames it.
  narrative: { chunkSize: 1000, chunkOverlap: 150 },
  // Larger chunks inside a section: the section breadcrumb carries the "where", and a
  // 200-page report needs fewer, denser vectors to stay inside the embedding quota.
  structured: { chunkSize: 1600, chunkOverlap: 200 },
  // Elements (a table, a chart, a callout) are already small and self-contained.
  visual: { chunkSize: 1200, chunkOverlap: 100 },
};

// Used when a document is uploaded without an explicit profile.
export function detectProfile(pageCount: number, outlineEntries: number): Profile {
  if (pageCount >= 100 && outlineEntries >= 5) return "structured";
  if (pageCount <= 20) return "visual";
  return "narrative";
}

export function isProfile(value: unknown): value is Profile {
  return typeof value === "string" && (PROFILES as string[]).includes(value);
}
