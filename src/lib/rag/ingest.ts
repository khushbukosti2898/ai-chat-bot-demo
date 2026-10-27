// Stages 1-5 in one call: parse -> (visual parse) -> chunk -> embed -> store -> register.
// Used by both the upload API route and the `npm run ingest` script.
import { chunkDocument, type Chunk } from "./chunk";
import { parseFile, parseVisual, type VisualElement } from "./parse";
import { detectProfile, type Profile } from "./profiles";
import { buildVectorStore, docIdFor, registerDocument, type DocInfo } from "./vectorstore";

export type IngestResult = { document: DocInfo; chunks: Chunk[] };

export async function ingestFile(
  buffer: Buffer,
  filename: string,
  profile?: Profile,
  log: (msg: string) => void = () => {},
): Promise<IngestResult> {
  const parsed = await parseFile(buffer, filename);
  const isPdf = filename.toLowerCase().endsWith(".pdf");
  // Plain text has no pages, outline or graphics, so only the narrative profile applies.
  const chosen = isPdf ? (profile ?? detectProfile(parsed.pages.length, parsed.outline.length)) : "narrative";
  log(`${filename}: ${parsed.pages.length} pages, ${parsed.outline.length} outline entries, profile=${chosen}`);

  let elements: VisualElement[] = [];
  if (chosen === "visual") {
    log("Reading pages visually with Gemini (cached after the first run)...");
    elements = await parseVisual(buffer, parsed.pages.length);
    log(`Extracted ${elements.length} elements`);
  }

  const chunks = await chunkDocument(chosen, parsed, elements);
  log(`${chunks.length} chunks`);

  const id = docIdFor(filename);
  await buildVectorStore(id, chunks, (done, total) => log(`Embedded ${done}/${total} new chunks`));

  const document: DocInfo = {
    id,
    filename,
    profile: chosen,
    pages: parsed.pages.length,
    chunks: chunks.length,
    characters: parsed.pages.reduce((n, p) => n + p.length, 0),
    indexedAt: new Date().toISOString(),
  };
  await registerDocument(document);
  return { document, chunks };
}
