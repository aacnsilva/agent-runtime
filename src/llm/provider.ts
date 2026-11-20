import type { ModelId } from "./catalog";
import type { Usage } from "./cost";

export interface TextBlock {
  type: "text";
  text: string;
}

export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: true;
}

export interface ImageBlock {
  type: "image";
  mediaType: "image/jpeg";
  data: string;
}

export type ReplyBlock = TextBlock | ToolUseBlock;
export type MessageBlock = ReplyBlock | ToolResultBlock | ImageBlock;

export interface ModelMessage {
  role: "user" | "assistant";
  content: string | MessageBlock[];
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ToolSpec {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ModelRequest {
  maxOutputTokens: number;
  effort: "low" | "medium" | "high";
  system: string;
  systemTail: readonly string[];
  messages: readonly ModelMessage[];
  trailingReminder: string | undefined;
  replySchema: Record<string, unknown> | undefined;
  tools: readonly ToolSpec[];
  thinking: "default" | "off";
}

export interface ModelReply {
  text: string;
  blocks: ReplyBlock[];
  stopReason: string | null;
  usage: Usage;
}

export interface Listeners {
  onText?: (text: string) => void;
  onTool?: () => void;
}

export type FailureKind = "unavailable" | "rejected" | "timeout" | "aborted";

export interface Provider {
  complete: (model: ModelId, request: ModelRequest, listeners: Listeners) => Promise<ModelReply>;
  failureKind: (error: unknown) => FailureKind;
}
