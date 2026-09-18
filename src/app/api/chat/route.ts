// POST /api/chat  { docId, question, history, k? }
// Runs stages 6-7: retrieve -> LLM. Returns the answer and the chunks it was grounded on.
import { NextResponse } from "next/server";
import { answerQuestion, type ChatTurn } from "@/lib/rag/llm";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const { docId, question, history = [], k } = (await req.json()) as {
      docId: string; question: string; history?: ChatTurn[]; k?: number;
    };
    if (!docId || !question?.trim()) {
      return NextResponse.json({ error: "docId and question are required" }, { status: 400 });
    }
    const result = await answerQuestion(docId, question.trim(), history, k);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Chat failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
