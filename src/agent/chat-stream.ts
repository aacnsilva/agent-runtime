export interface ChatStream {
  push: (text: string) => string;
  tool: () => void;
}

export interface ChatStreamOptions {
  holdChars: number;
  maxChars: number;
}

export const createChatStream = (options: ChatStreamOptions): ChatStream => {
  let held = "";
  let open = false;
  let closed = false;
  let sent = 0;

  const capped = (text: string): string => {
    const piece = text.slice(0, Math.max(0, options.maxChars - sent));
    sent += piece.length;
    return piece;
  };

  const push = (text: string): string => {
    if (closed) {
      return "";
    }
    if (open) {
      return capped(text);
    }
    held = (held + text).trimStart();
    if (held.length < options.holdChars) {
      return "";
    }
    open = true;
    const piece = capped(held);
    held = "";
    return piece;
  };

  const tool = (): void => {
    closed = true;
    held = "";
  };

  return { push, tool };
};
