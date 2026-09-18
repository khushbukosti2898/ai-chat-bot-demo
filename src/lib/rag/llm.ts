// Stage 7: LLM Response
// Combine the retrieved chunks + chat history + new question into one prompt
// and ask Gemini. The "answer ONLY from the context" rule is what makes this
// a grounded RAG system instead of a model guessing from general knowledge.
import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { config } from "./config";
import { retrieve, type RetrievedChunk } from "./vectorstore";

export type ChatTurn = { role: "user" | "assistant"; content: string };

const SYSTEM_PROMPT = `You are a helpful assistant that answers questions about an uploaded document.

Rules:
- Answer using ONLY the CONTEXT below and facts already established earlier in this conversation.
- If the answer is not in the context, reply exactly: "I don't have that information in the document."
- Do not use outside knowledge and do not guess.
- Keep answers concise. Mention the page number when the context provides one.

CONTEXT:
{context}`;

function formatContext(chunks: RetrievedChunk[]): string {
  return chunks
    .map((c) => `[Chunk ${c.chunk}${c.page ? `, page ${c.page}` : ""}]\n${c.text}`)
    .join("\n\n");
}

// Gemini may return content as a string or as a list of content blocks.
function getText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b) => typeof b === "object" && b !== null && (b as { type?: string }).type === "text")
      .map((b) => (b as { text: string }).text)
      .join("");
  }
  return String(content ?? "");
}

export async function answerQuestion(
  docId: string,
  question: string,
  history: ChatTurn[],
  k = config.topK,
): Promise<{ answer: string; chunks: RetrievedChunk[] }> {
  const chunks = await retrieve(docId, question, k);

  const messages = [
    new SystemMessage(SYSTEM_PROMPT.replace("{context}", formatContext(chunks))),
    ...history.map((t) => (t.role === "user" ? new HumanMessage(t.content) : new AIMessage(t.content))),
    new HumanMessage(question),
  ];

  const llm = new ChatGoogleGenerativeAI({
    model: config.llmModel,
    temperature: config.temperature,
  });
  const response = await llm.invoke(messages);
  return { answer: getText(response.content), chunks };
}
