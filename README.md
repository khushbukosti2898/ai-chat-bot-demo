# RAG Document Chatbot (Next.js POC)

A small end-to-end Retrieval-Augmented Generation chatbot built for the AI training
assignment. Upload a PDF / TXT / Markdown file and ask questions about it. Answers are
grounded only in the retrieved parts of the document, and the bot refuses when the
answer is not there.

```
Document Upload → Parsing → Chunking → Embeddings → Vector Storage → Retrieval → LLM Response
```

## Stack

| Piece | Choice | Why |
|---|---|---|
| App framework | Next.js 16 (App Router, TypeScript) | UI + API routes in one project |
| AI framework | LangChain.js | Same concepts as the training notebook, in TypeScript |
| LLM | Google Gemini (`gemini-3.1-flash-lite`) | Fast, free tier, used in the workshop |
| Embeddings | `gemini-embedding-001` | Same provider, one API key |
| Vector store | [Vectra](https://github.com/Stevenic/vectra) — file-based, pure TypeScript | Real vector index, persisted to `data/`, no server to run |
| PDF parsing | `unpdf` | Works inside Next.js server routes without native deps |
| Styling | Tailwind CSS | Comes with `create-next-app` |

## Setup

```bash
npm install
cp .env.example .env.local     # paste your Gemini key from https://aistudio.google.com/app/apikey
npm run dev                    # http://localhost:3000
```

## How each stage is implemented

| Stage | Where | Notes |
|---|---|---|
| Upload | `src/app/page.tsx` → `POST /api/upload` | Multipart form, file kept in memory |
| Parsing | `src/lib/rag/parse.ts` | PDF → one `Document` per page (page number kept in metadata) |
| Chunking | `src/lib/rag/chunk.ts` | `RecursiveCharacterTextSplitter`, 500 chars, 80 overlap |
| Embeddings | `src/lib/rag/embeddings.ts` | Gemini embedding model, one batched call per upload |
| Vector storage | `src/lib/rag/vectorstore.ts` → `buildVectorStore()` | One Vectra index per document under `data/indexes/<docId>` |
| Retrieval | `src/lib/rag/vectorstore.ts` → `retrieve()` | Embed the question, cosine similarity, top-k chunks |
| LLM response | `src/lib/rag/llm.ts` → `answerQuestion()` | System prompt with retrieved context + chat history + question |

`src/lib/rag/config.ts` holds every tunable (models, chunk size, overlap, k), all
overridable from `.env.local`.

The chat keeps **short-term memory**: previous turns are sent back with each request,
so follow-ups like "can I carry them over?" work. Indexed documents persist across
restarts, and `GET /api/documents` lists them.

## API

| Route | Body | Returns |
|---|---|---|
| `POST /api/upload` | multipart `file` | document stats, chunk settings, first 5 chunks |
| `POST /api/chat` | `{ docId, question, history, k? }` | `{ answer, chunks }` — chunks include page + similarity score |
| `GET /api/documents` | – | list of indexed documents |

## Demo script

Using `sample_docs/bacancy_handbook.md` (tested, all five behave as described):

1. "How many vacation days do full-time employees get?" → 18 days, from the Leave Policy chunk.
2. "Can I carry them over to next year?" → up to 5 days (follow-up resolved via history + retrieval).
3. "What is the annual learning budget?" → $1,000.
4. "What is the capital of France?" → refuses: not in the document.
5. "Does Bacancy offer a 401k match?" → refuses: plausible-sounding but not in the document.

Every answer has an expandable "Retrieved chunks" section showing exactly which chunks
and similarity scores the answer was grounded on. That is the easiest way to *see*
retrieval working (and to see why chunk size matters).

## Things I learned / would do next

- Chunk size is a real trade-off: too small and a fact gets split, too large and
  irrelevant text dilutes the context.
- The single most important line is the "answer ONLY from the context" instruction.
  Without it the model happily answers from general knowledge.
- Similarity scores for off-topic questions are noticeably lower (≈0.45 vs ≈0.75), so a
  score threshold could short-circuit the LLM call entirely.
- Next steps: chatting across multiple documents at once, hybrid keyword + vector
  search, streaming answers, and a small evaluation set to measure answer accuracy.
