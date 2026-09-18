// Stage 4: Embeddings
// The model that turns a piece of text into a vector of numbers capturing its meaning.
// Texts with similar meaning end up with vectors that are close together.
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { config } from "./config";

let cached: GoogleGenerativeAIEmbeddings | null = null;

export function getEmbeddings(): GoogleGenerativeAIEmbeddings {
  cached ??= new GoogleGenerativeAIEmbeddings({ model: config.embeddingModel });
  return cached;
}
