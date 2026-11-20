const HEADING = /^#{1,6}\s+\S/;

const splitLong = (paragraph: string, maxChars: number): string[] => {
  const pieces: string[] = [];
  let rest = paragraph;
  while (rest.length > maxChars) {
    const window = rest.slice(0, maxChars);
    const sentenceEnd = Math.max(window.lastIndexOf(". "), window.lastIndexOf("\n"));
    const wordEnd = window.lastIndexOf(" ");
    const cut = sentenceEnd > maxChars / 2 ? sentenceEnd + 1 : wordEnd > 0 ? wordEnd : maxChars;
    pieces.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  return rest === "" ? pieces : [...pieces, rest];
};

interface Draft {
  chunks: string[];
  heading: string;
  current: string;
}

const flush = (draft: Draft): void => {
  if (draft.current.trim() !== "") {
    draft.chunks.push(draft.current.trim());
  }
  draft.current = "";
};

const startWith = (draft: Draft, piece: string): string =>
  draft.heading === "" || piece.startsWith(draft.heading) ? piece : `${draft.heading}\n${piece}`;

const add = (draft: Draft, piece: string, maxChars: number): void => {
  if (draft.current !== "" && draft.current.length + piece.length + 2 > maxChars) {
    flush(draft);
  }
  draft.current = draft.current === "" ? startWith(draft, piece) : `${draft.current}\n\n${piece}`;
};

export const chunkText = (text: string, maxChars: number): string[] => {
  const draft: Draft = { chunks: [], heading: "", current: "" };
  const paragraphs = text
    .replaceAll("\r\n", "\n")
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== "");
  for (const paragraph of paragraphs) {
    const firstLine = paragraph.split("\n", 1)[0] ?? "";
    if (HEADING.test(firstLine)) {
      flush(draft);
      draft.heading = firstLine;
    }
    for (const piece of splitLong(paragraph, maxChars)) {
      add(draft, piece, maxChars);
    }
  }
  flush(draft);
  return draft.chunks;
};
