// Stage 3: Chunking
// Split documents into overlapping pieces. Smaller chunks are about one topic
// each, which makes similarity search precise; overlap avoids cutting a fact in half.
import { Document } from "@langchain/core/documents";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { config } from "./config";

export async function chunkDocuments(docs: Document[]): Promise<Document[]> {
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: config.chunkSize,
    chunkOverlap: config.chunkOverlap,
  });
  return splitter.splitDocuments(docs);
}
