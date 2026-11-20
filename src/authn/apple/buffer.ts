import { Buffer as RuntimeBuffer } from "node:buffer";

const isBufferConstructor = (value: unknown): value is BufferConstructor =>
  typeof value === "function";

const loaded: unknown = RuntimeBuffer;

if (!isBufferConstructor(loaded)) {
  throw new TypeError("node:buffer is unavailable");
}

export const Buffer: BufferConstructor = loaded;
