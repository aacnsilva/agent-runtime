import type { ModelId } from "./catalog";
import type { Usage } from "./cost";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface CompletionRequest {
  maxOutputTokens: number;
  effort: "low" | "medium" | "high";
  system: string;
  messages: readonly ChatMessage[];
  reminder: string | undefined;
  replySchema: Record<string, unknown>;
}

export interface Completion {
  text: string;
  stopReason: string | null;
  usage: Usage;
}

export type TextListener = (text: string) => void;

export interface Provider {
  complete: (
    model: ModelId,
    request: CompletionRequest,
    onText: TextListener | undefined,
  ) => Promise<Completion>;
  isTimeout: (error: unknown) => boolean;
}
