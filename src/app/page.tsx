"use client";

import { useEffect, useRef, useState } from "react";

type DocInfo = { id: string; filename: string; pages: number; chunks: number; characters: number; indexedAt: string };
type Chunk = { text: string; page: number; chunk: number; score?: number };
type Message = { role: "user" | "assistant"; content: string; chunks?: Chunk[] };
type UploadResult = {
  document: DocInfo;
  settings: { chunkSize: number; chunkOverlap: number; embeddingModel: string };
  preview: { chunk: number; page: number | null; text: string }[];
};

const STAGES = ["Upload", "Parse", "Chunk", "Embed", "Store", "Retrieve", "Answer"];

export default function Home() {
  const [documents, setDocuments] = useState<DocInfo[]>([]);
  const [activeDoc, setActiveDoc] = useState<DocInfo | null>(null);
  const [upload, setUpload] = useState<UploadResult | null>(null);
  const [uploading, setUploading] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [asking, setAsking] = useState(false);
  const [topK, setTopK] = useState(3);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/documents").then((r) => r.json()).then((d) => setDocuments(d.documents ?? [])).catch(() => {});
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, asking]);

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      setUpload(data);
      setActiveDoc(data.document);
      setDocuments((prev) => [data.document, ...prev.filter((d) => d.id !== data.document.id)]);
      setMessages([]);
      if (fileRef.current) fileRef.current.value = "";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleAsk(e: React.FormEvent) {
    e.preventDefault();
    const question = input.trim();
    if (!question || !activeDoc || asking) return;
    setInput("");
    setError(null);
    const history = messages.map(({ role, content }) => ({ role, content }));
    setMessages((m) => [...m, { role: "user", content: question }]);
    setAsking(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docId: activeDoc.id, question, history, k: topK }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Chat failed");
      setMessages((m) => [...m, { role: "assistant", content: data.answer, chunks: data.chunks }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chat failed");
    } finally {
      setAsking(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 px-4 py-8">
      <header>
        <h1 className="text-2xl font-semibold">📄 RAG Document Chatbot</h1>
        <p className="mt-1 text-sm text-zinc-500">
          {STAGES.map((s, i) => (
            <span key={s}>
              {s}
              {i < STAGES.length - 1 && <span className="mx-1.5 text-zinc-400">→</span>}
            </span>
          ))}
        </p>
      </header>

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          {error}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        {/* ---------------- Sidebar ---------------- */}
        <aside className="flex flex-col gap-4">
          <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="mb-3 font-medium">1. Upload a document</h2>
            <form onSubmit={handleUpload} className="flex flex-col gap-3">
              <input ref={fileRef} type="file" accept=".pdf,.txt,.md" required
                className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-zinc-100 file:px-3 file:py-1.5 file:text-sm dark:file:bg-zinc-800" />
              <button type="submit" disabled={uploading}
                className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
                {uploading ? "Parsing → chunking → embedding…" : "Index document"}
              </button>
            </form>

            {upload && (
              <div className="mt-4 space-y-1 text-xs text-zinc-600 dark:text-zinc-400">
                <p>📖 Parsed <b>{upload.document.pages}</b> page(s), {upload.document.characters.toLocaleString()} chars</p>
                <p>✂️ Split into <b>{upload.document.chunks}</b> chunks (size {upload.settings.chunkSize}, overlap {upload.settings.chunkOverlap})</p>
                <p>🔢 Embedded with <code>{upload.settings.embeddingModel}</code></p>
                <p>💾 Stored in <code>data/indexes/{upload.document.id}</code></p>
                <details className="mt-2">
                  <summary className="cursor-pointer">Preview first chunks</summary>
                  <div className="mt-2 space-y-2">
                    {upload.preview.map((c) => (
                      <pre key={c.chunk} className="whitespace-pre-wrap rounded bg-zinc-100 p-2 text-[11px] dark:bg-zinc-800">
                        <b>Chunk {c.chunk}{c.page ? ` · page ${c.page}` : ""}</b>{"\n"}{c.text}
                      </pre>
                    ))}
                  </div>
                </details>
              </div>
            )}
          </section>

          {documents.length > 0 && (
            <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <h2 className="mb-3 font-medium">Indexed documents</h2>
              <ul className="space-y-1">
                {documents.map((d) => (
                  <li key={d.id}>
                    <button onClick={() => { setActiveDoc(d); setMessages([]); setUpload(null); }}
                      className={`w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 ${activeDoc?.id === d.id ? "bg-indigo-50 font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300" : ""}`}>
                      {d.filename}
                      <span className="block text-xs text-zinc-500">{d.chunks} chunks</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="mb-3 font-medium">Settings</h2>
            <label className="block text-sm">
              Chunks to retrieve (k): <b>{topK}</b>
              <input type="range" min={1} max={8} value={topK} onChange={(e) => setTopK(Number(e.target.value))} className="mt-1 w-full" />
            </label>
            <button onClick={() => setMessages([])} className="mt-3 text-sm text-zinc-500 hover:underline">Clear chat</button>
          </section>
        </aside>

        {/* ---------------- Chat ---------------- */}
        <section className="flex min-h-[70vh] flex-col rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div className="border-b border-zinc-200 px-4 py-3 text-sm dark:border-zinc-800">
            {activeDoc ? <>2. Chatting with <b>{activeDoc.filename}</b></> : "2. Upload or select a document to start chatting"}
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
            {messages.length === 0 && activeDoc && (
              <p className="text-sm text-zinc-500">
                Try: &ldquo;How many vacation days do employees get?&rdquo; then &ldquo;Can I carry them over?&rdquo; and finally something not in the document.
              </p>
            )}
            {messages.map((m, i) => (
              <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${m.role === "user" ? "bg-indigo-600 text-white" : "bg-zinc-100 dark:bg-zinc-800"}`}>
                  <p className="whitespace-pre-wrap">{m.content}</p>
                  {m.chunks && m.chunks.length > 0 && (
                    <details className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
                      <summary className="cursor-pointer">Retrieved {m.chunks.length} chunk(s) used for this answer</summary>
                      <div className="mt-2 space-y-2">
                        {m.chunks.map((c) => (
                          <pre key={c.chunk} className="whitespace-pre-wrap rounded bg-white p-2 text-[11px] dark:bg-zinc-900">
                            <b>Chunk {c.chunk}{c.page ? ` · page ${c.page}` : ""}{c.score !== undefined ? ` · score ${c.score.toFixed(3)}` : ""}</b>{"\n"}{c.text}
                          </pre>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              </div>
            ))}
            {asking && <p className="text-sm text-zinc-500">Retrieving context and generating answer…</p>}
            <div ref={bottomRef} />
          </div>

          <form onSubmit={handleAsk} className="flex gap-2 border-t border-zinc-200 p-3 dark:border-zinc-800">
            <input value={input} onChange={(e) => setInput(e.target.value)} disabled={!activeDoc || asking}
              placeholder={activeDoc ? `Ask something about ${activeDoc.filename}` : "Index a document first"}
              className="flex-1 rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-indigo-500 dark:border-zinc-700" />
            <button type="submit" disabled={!activeDoc || asking || !input.trim()}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
              Send
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
