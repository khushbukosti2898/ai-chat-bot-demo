// GET /api/documents  -> list of already-indexed documents (persisted across restarts)
import { NextResponse } from "next/server";
import { listDocuments } from "@/lib/rag/vectorstore";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ documents: await listDocuments() });
}
