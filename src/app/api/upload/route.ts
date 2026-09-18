// POST /api/upload  (multipart form, field "file")
// Runs stages 1-5: parse -> chunk -> embed -> store. Returns stats + a chunk preview.
import { NextResponse } from "next/server";
import { parseFile } from "@/lib/rag/parse";
import { chunkDocuments } from "@/lib/rag/chunk";
import { buildVectorStore, docIdFor, registerDocument } from "@/lib/rag/vectorstore";
import { config } from "@/lib/rag/config";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const docs = await parseFile(buffer, file.name);
    const chunks = await chunkDocuments(docs);
    const id = docIdFor(file.name);
    await buildVectorStore(id, chunks);

    const info = {
      id,
      filename: file.name,
      pages: docs.length,
      chunks: chunks.length,
      characters: docs.reduce((n, d) => n + d.pageContent.length, 0),
      indexedAt: new Date().toISOString(),
    };
    await registerDocument(info);

    return NextResponse.json({
      document: info,
      settings: { chunkSize: config.chunkSize, chunkOverlap: config.chunkOverlap, embeddingModel: config.embeddingModel },
      preview: chunks.slice(0, 5).map((c, i) => ({ chunk: i + 1, page: c.metadata.page ?? null, text: c.pageContent })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
