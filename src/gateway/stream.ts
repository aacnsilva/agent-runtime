import type { RequestContext } from "./context";

export type StreamEvent = Record<string, unknown>;
export type Emit = (event: StreamEvent) => void;

const sseHeaders = (): Headers => {
  const headers = new Headers();
  headers.set("content-type", "text/event-stream; charset=utf-8");
  headers.set("cache-control", "no-store");
  return headers;
};

export const streamResponse = (
  context: RequestContext,
  run: (emit: Emit) => Promise<StreamEvent>,
): Response => {
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const send = async (event: StreamEvent): Promise<void> => {
    await writer.write(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)).catch(() => undefined);
  };
  const work = async (): Promise<void> => {
    const last = await run((event) => void send(event));
    await send(last);
    await writer.close().catch(() => undefined);
  };
  context.ctx.waitUntil(work());
  return new Response(readable, { status: 200, headers: sseHeaders() });
};

export const wantsStream = (request: Request): boolean =>
  (request.headers.get("Accept") ?? "").includes("text/event-stream");
