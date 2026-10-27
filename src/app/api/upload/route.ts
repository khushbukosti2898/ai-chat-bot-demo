// POST /api/upload  (multipart form, fields "file" and optional "profile")
// Runs stages 1-5: parse -> chunk -> embed -> store. Returns stats + a chunk preview.
import { NextResponse } from "next/server";
import { ingestFile } from "@/lib/rag/ingest";
import { chunkSettings, isProfile } from "@/lib/rag/profiles";
import { config } from "@/lib/rag/config";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }
    const profileField = form.get("profile");
    const profile = isProfile(profileField) ? profileField : undefined;

    const buffer = Buffer.from(await file.arrayBuffer());
    const { document, chunks } = await ingestFile(buffer, file.name, profile);

    return NextResponse.json({
      document,
      settings: { ...chunkSettings[document.profile], embeddingModel: config.embeddingModel },
      preview: chunks.slice(0, 5).map((c) => ({ chunk: c.id, page: c.page, section: c.section, text: c.text })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
