# RAG Document Chatbot (Next.js POC)

A small end-to-end Retrieval-Augmented Generation chatbot built for the AI training
assignment. Upload a PDF / TXT / Markdown file and ask questions about it. Answers are
grounded only in the retrieved parts of the document, and the bot refuses when the
answer is not there.

```
Document → Parsing → Chunking → Embedding → Retrieval → Reranking → Context → LLM → Evaluation
```

The pipeline adapts to the document's shape through **profiles** (`src/lib/rag/profiles.ts`):

| Profile | For | Key idea |
|---|---|---|
| `narrative` | plain-text reports (GPO annual report) | clean headers, stitch pages, paragraph-aware chunks |
| `structured` | long reports with chapters (World Bank GEP) | PDF outline → section breadcrumbs on every chunk, section-scoped retrieval |
| `visual` | charts/tables/footnotes (Apple environmental report) | Gemini reads each page visually into typed elements; footnotes attached to what cites them |

The full per-stage design and eval results for the Advanced RAG challenge are in
[`docs/ADVANCED_RAG_REQUIREMENTS.md`](docs/ADVANCED_RAG_REQUIREMENTS.md).

## Stack

| Piece | Choice | Why |
|---|---|---|
| App framework | Next.js 16 (App Router, TypeScript) | UI + API routes in one project |
| AI framework | LangChain.js | Same concepts as the training notebook, in TypeScript |
| LLM | Google Gemini (`gemini-3.1-flash-lite`) | Answers, reranking and visual page parsing |
| Embeddings | `gemini-embedding-001` (document/query task types) | Same provider, one API key |
| Vector store | [Vectra](https://github.com/Stevenic/vectra), file-based, pure TypeScript | Real vector index, persisted to `data/`, no server to run |
| Keyword search | BM25 (`src/lib/rag/bm25.ts`) | Exact terms and numbers that vectors blur |
| PDF parsing | `unpdf` (+ Gemini for visual pages) | Works inside Next.js server routes without native deps |
| Styling | Tailwind CSS | Comes with `create-next-app` |

## Setup

```bash
npm install
cp .env.example .env.local     # paste your Gemini key from https://aistudio.google.com/app/apikey
npm run ingest                 # index the 3 challenge PDFs in sample_docs/ (~10 min on the free tier)
npm run eval                   # score the challenge questions
npm run dev                    # http://localhost:3000
```

`npm run ingest -- path/to/file.pdf [narrative|structured|visual]` indexes a single file.
The UI upload also accepts a profile (or auto-detects one).

Embeddings are cached in `data/embed-cache/` and visual parses in `data/parsed/`, so
re-running ingest only pays for what changed. The free tier caps embeddings at 100/min,
~30k tokens/min and 1000/day; ingestion throttles itself to fit.

## How each stage is implemented

| Stage | Where |
|---|---|
| Parsing | `parse.ts`: page text with running headers removed, PDF outline, visual page parsing |
| Chunking | `chunk.ts`: one strategy per profile |
| Embedding | `embeddings.ts`: task types, disk cache, quota throttle |
| Storage | `vectorstore.ts`: Vectra index + `chunks.json` per document |
| Retrieval | `retrieve.ts`: section scoping → vector + BM25 → Reciprocal Rank Fusion |
| Reranking | `rerank.ts`: Gemini scores candidates 0-10, weak ones dropped |
| Context + LLM | `llm.ts`: numbered sources with page/section/type, grounded prompt, citations, refusal |
| Evaluation | `scripts/eval.ts` + `eval/questions.json` |

All tunables live in `src/lib/rag/config.ts` and can be overridden from `.env.local`.

## API

| Route | Body | Returns |
|---|---|---|
| `POST /api/upload` | multipart `file`, optional `profile` | document stats, chunk settings, first 5 chunks |
| `POST /api/chat` | `{ docId, question, history, k? }` | `{ answer, chunks, scope }`: chunks include page, section, type and rerank score |
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
- One pipeline does not fit every document. Section scoping fixed region mix-ups in the
  long report, and the iMac's carbon split (50% production / 45% use) only exists in the
  page graphics, so only a visual parse can find it.
- Next steps: chatting across multiple documents at once, streaming answers, and
  rewriting follow-up questions into standalone queries before retrieval.
