// npm run ingest                              -> ingest the 3 challenge PDFs with their profiles
// npm run ingest -- path/to/file.pdf [profile] -> ingest one file (profile auto-detected if omitted)
import fs from "node:fs/promises";
import path from "node:path";
import { ingestFile } from "../src/lib/rag/ingest";
import { isProfile, type Profile } from "../src/lib/rag/profiles";

const CHALLENGE_DOCS: [string, Profile][] = [
  ["sample_docs/GPO-Anual-report.pdf", "narrative"],
  ["sample_docs/GEP-Jun-2026.pdf", "structured"],
  ["sample_docs/iMac_PER_Oct2024.pdf", "visual"],
];

async function main() {
  const [file, profile] = process.argv.slice(2);
  const jobs: [string, Profile | undefined][] = file ? [[file, isProfile(profile) ? profile : undefined]] : CHALLENGE_DOCS;

  for (const [filePath, p] of jobs) {
    const started = Date.now();
    const { document } = await ingestFile(await fs.readFile(filePath), path.basename(filePath), p, (msg) => console.log(`  ${msg}`));
    console.log(`✓ ${document.filename} -> data/indexes/${document.id} (${((Date.now() - started) / 1000).toFixed(1)}s)\n`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
