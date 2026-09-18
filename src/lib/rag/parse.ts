// Stage 1-2: Upload -> Parsing
// Turn an uploaded file (PDF / TXT / MD) into LangChain Document objects.
// PDFs become one Document per page so page numbers survive into metadata.
import { Document } from "@langchain/core/documents";
import { extractText, getDocumentProxy } from "unpdf";

export async function parseFile(buffer: Buffer, filename: string): Promise<Document[]> {
  const ext = filename.toLowerCase().split(".").pop();

  if (ext === "pdf") {
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await extractText(pdf, { mergePages: false });
    return text
      .map((pageText, i) => new Document({
        pageContent: pageText,
        metadata: { source: filename, page: i + 1 },
      }))
      .filter((d) => d.pageContent.trim().length > 0);
  }

  if (ext === "txt" || ext === "md") {
    return [new Document({ pageContent: buffer.toString("utf-8"), metadata: { source: filename } })];
  }

  throw new Error(`Unsupported file type ".${ext}". Upload a .pdf, .txt or .md file.`);
}
