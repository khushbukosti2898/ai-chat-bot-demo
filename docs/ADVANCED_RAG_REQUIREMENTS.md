# Advanced RAG Hands-On Challenge — Requirements

## Description

We've finished the basic Chatbot implementation. The next step is a production-style RAG challenge on 3 documents, each with a deliberately different structure. Build one Q&A system for each document. Work through them in this order, from easiest to hardest.

| # | Document | Source file | Shape |
|---|----------|-------------|-------|
| 1 | GPO 2018 Annual Report | `GPO-Anual-report.pdf` | 82 pages, narrative text |
| 2 | World Bank Global Economic Prospects, June 2026 | `GEP-Jun-2026.pdf` | 200 pages, with chapters, sections, boxes and a stats annex |
| 3 | Apple iMac Product Environmental Report | `iMac_PER_Oct2024.pdf` | 11 pages, with charts, tables, icons and footnotes |

---

## Use Case 1: Plain-text report Q&A

**Document:** GPO 2018 Annual Report (82 pages, narrative text)
**Focus:** ingestion, chunking, embeddings, retrieval, response generation (the baseline)

**Test questions:**
1. How many depository libraries did GPO staff visit in FY 2018?
2. What new digital system replaced FDsys, and when was it fully deployed?
3. How much did GPO procure in printing and information products in FY 2018 on behalf of federal agencies?

**Pass bar:** it finds the exact fact in the paragraph and adds nothing that isn't in the document.

---

## Use Case 2: Long, structured report

**Document:** World Bank Global Economic Prospects, June 2026 (200 pages, with chapters, sections, boxes and a stats annex)
**Focus:** hierarchical chunking, section-aware retrieval, context management

**Test questions:**
1. What is the growth outlook for South Asia in this report?
2. What does Chapter 3 say about sovereign debt in developing economies?
3. According to the executive summary, what are the main risks to the global outlook?

**Pass bar:** it retrieves the right chapter and section, and never mixes up facts between regions or chapters.

---

## Use Case 3: Short, visual document

**Document:** Apple iMac Product Environmental Report (11 pages, with charts, tables, icons and footnotes)
**Focus:** extracting from tables, charts and footnotes; document-aware retrieval

**Test questions:**
1. How much less energy does iMac use compared to the ENERGY STAR requirement?
2. What is the total carbon footprint of the iMac, and how much comes from product use vs. manufacturing?
3. What material is the iMac stand made from, and what percentage is recycled?

**Pass bar:** it pulls the right number from the chart or table, not a vague nearby sentence.

---

## Expected pipeline

```
Document → Parsing → Chunking → Embedding → Retrieval → Reranking → Context → LLM → Evaluation
```

For each document, explain which approach you chose at each stage and why.

| Stage | GPO (narrative) | GEP (long, structured) | iMac (visual) |
|-------|-----------------|------------------------|---------------|
| Parsing | `unpdf` text per page; running headers/footers (letter-spaced "U . S . G O V…" lines, lines repeated on ≥25% of pages) removed | Same cleanup, plus the PDF outline (bookmarks) read as the section map: chapters, boxes, regional sub-sections | Gemini reads each page of the PDF visually and returns typed elements: `table` (Markdown), `chart` (every labelled value), `callout` (icon text), `footnote`, `text`. Cached on disk after the first run |
| Chunking | Pages stitched into one stream so paragraphs crossing a page break stay whole; recursive split at 1000 chars / 150 overlap; page range kept per chunk | Each page assigned to its section (boxes end when the "Box x.y" label disappears; contents pages skipped); split *within* a section at 1600 / 200, so no chunk mixes two regions; breadcrumb ("Ch. 2 Regional Outlooks > South Asia") stored and prefixed to the embedded text | One chunk per element; tables and charts never split (numbers stay with their headers); footnotes cited by an element are appended to it so caveats travel with the number |
| Embedding | `gemini-embedding-001` with `RETRIEVAL_DOCUMENT` / `RETRIEVAL_QUERY` task types; disk cache keyed by (model, task, text); throttled to 90/min to fit the free tier (1000/day); empty-vector responses raise an error | Same; the breadcrumb prefix makes "South Asia" part of every South Asia chunk's vector | Same; the `[table]` / `[chart]` prefix is embedded too |
| Retrieval | Hybrid: vector top-20 + BM25 top-20 merged with Reciprocal Rank Fusion. BM25 catches exact tokens ("FDsys", "FY 2018") | Section scoping first: "Chapter 3" or a section title named in the question ("South Asia", "executive summary") restricts both searches to that section, and the section's opening chunk is always a candidate. Then hybrid + RRF | Hybrid + RRF over elements |
| Reranking | Gemini scores the ~20 candidates 0-10 in one call; below 3 dropped; top 6 kept | Same; the prompt scores "different region/chapter" as 0 | Same |
| Context | Numbered sources `[S1] (page 5)` | `[S1] (pages 96-97 \| Ch. 2 Regional Outlooks > South Asia)`, plus the matched scope stated in the prompt | `[S1] (page 2 \| Carbon footprint \| chart)` so the model knows it is reading a chart or footnote |
| LLM | `gemini-3.1-flash-lite`, temperature 0.1. Answer only from sources, copy numbers exactly, cite `[Sn]` + page, fixed refusal sentence. No sources left after reranking → refuse without calling the LLM | Same + "use only sources from the asked chapter/region, never mix" | Same + "use tables, charts, footnotes; mention footnote caveats" |
| Evaluation | `npm run eval`: 9 challenge questions (expected facts as regexes + expected pages) and 3 unanswerable questions that must be refused. Reports answer pass rate and retrieval page-hit rate; each run saved to `eval/results/` | | |

Code map: `src/lib/rag/` — `parse.ts`, `chunk.ts`, `profiles.ts`, `embeddings.ts`, `vectorstore.ts`, `bm25.ts`, `retrieve.ts`, `rerank.ts`, `llm.ts`, `ingest.ts`. Scripts: `npm run ingest`, `npm run eval`.

### Results (`npm run eval`, 2026-10-27)

**Answers: 12/12 passed · Retrieval: 9/9 hit the expected page**

| Doc | Question | Answer (abridged) | Where it came from |
|-----|----------|-------------------|--------------------|
| GPO | Depository libraries visited | 166 | p. 5, p. 21 |
| GPO | FDsys replacement | govinfo, full-scale deployment over FY 2018; FDsys retired December 2018 | p. 4, p. 22 |
| GPO | Procurement on behalf of agencies | $375.7 million ("more than $375 million") | p. 5, 14, 17 |
| GEP | South Asia outlook | Growth softens to 6.3% in 2026, then ~7% a year in 2027-28 | scoped to *South Asia*, pp. 96-98 |
| GEP | Chapter 3 on sovereign debt | Rising debt raises spreads/yields, non-linearly; policy responses | scoped to *Ch. 3*, pp. 109-112 |
| GEP | Exec summary risks | Escalation of hostilities, commodity disruptions, financial stress, trade policy uncertainty, weather shocks | scoped to *Executive Summary*, pp. 19-20 |
| iMac | vs ENERGY STAR | 58% less energy | p. 7 |
| iMac | Carbon footprint | 346 kg CO2e; production 50%, product use 45% | **table on p. 10, found only by the visual parse** (the percentages are not in the PDF's text layer) |
| iMac | Stand material | 100% recycled aluminum | callout, p. 4 |
| all | 3 unanswerable questions | Refused | |

## General expectations

- Answers grounded in the source
- Minimal hallucination
- Efficient handling of large documents
