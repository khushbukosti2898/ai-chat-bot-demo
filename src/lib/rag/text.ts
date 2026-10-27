// Small text helpers shared across stages.

// Gemini may return content as a string or as a list of content blocks.
export function getText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b) => typeof b === "object" && b !== null && (b as { type?: string }).type === "text")
      .map((b) => (b as { text: string }).text)
      .join("");
  }
  return String(content ?? "");
}

const STOPWORDS = new Set(
  "a an and are as at be by did do does for from has have how in is it its of on or that the this to was were what when which who will with".split(" "),
);

// Lowercase word tokens for keyword search. Keeps numbers and decimals ("2.5", "fy2018").
export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+(?:\.[0-9]+)?/g) ?? []).filter((t) => !STOPWORDS.has(t));
}
