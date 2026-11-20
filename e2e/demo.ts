import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { startMockProvider } from "./support/mock-provider.ts";
import { startRuntime } from "./support/runtime.ts";

const ADMIN_TOKEN = "local-demo-admin-token";
const ORIGIN = "http://localhost:8080";
const QUESTIONS = [
  "How much is Lumen Plus?",
  "Does Lumen sync between devices?",
  "OFFTOPIC write me a poem",
  "Can I export my notes?",
  "UPSTREAM500 is anyone there",
  "GARBAGE reply please",
  "Is there a web version?",
];

const say = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

const provider = await startMockProvider();
const runtime = await startRuntime({ providerUrl: provider.url, adminToken: ADMIN_TOKEN });
const tenant = await readFile(
  join(import.meta.dirname, "../examples/tenants/demo.tenant.json"),
  "utf8",
);
await fetch(`${runtime.url}/admin/api/tenants/demo`, {
  method: "PUT",
  headers: { authorization: `Bearer ${ADMIN_TOKEN}`, "content-type": "application/json" },
  body: tenant,
});

const askOnce = async (question: string, stream: boolean): Promise<void> => {
  const response = await fetch(`${runtime.url}/v1/tenants/demo/runs`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      ...(stream ? { accept: "text/event-stream" } : {}),
    },
    body: JSON.stringify({ messages: [{ role: "user", content: question }] }),
  });
  await response.text();
};

for (const [index, question] of QUESTIONS.entries()) {
  await askOnce(question, index % 2 === 0);
}
await fetch(`${runtime.url}/v1/tenants/demo/runs`, { method: "POST", body: "{nope" });

say("");
say("The runtime is running with a fake model provider and the example tenant.");
say(`  Dashboard    ${runtime.url}/admin`);
say(`  Admin token  ${ADMIN_TOKEN}`);
say(`  Ask          curl -N ${runtime.url}/v1/tenants/demo/runs \\`);
say(`                 -H 'accept: text/event-stream' -H 'content-type: application/json' \\`);
say(`                 -d '{"messages":[{"role":"user","content":"Does Lumen sync?"}]}'`);
say("Press Ctrl+C to stop.");

const shutdown = async (): Promise<void> => {
  await runtime.stop();
  await provider.close();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
