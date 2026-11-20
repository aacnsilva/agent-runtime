export interface RunEvent {
  at: number;
  tenant: string;
  requestId: string;
  outcome: string;
  status: number;
  streamed: boolean;
  model: string | null;
  attempts: number;
  latencyMs: number;
  ttftMs: number | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costNanoEur: number;
}
