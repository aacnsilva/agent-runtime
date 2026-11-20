import { randomBytes } from "node:crypto";

import { startMockProvider } from "./support/mock-provider.ts";
import { startRuntime } from "./support/runtime.ts";

export default async function setup(): Promise<() => Promise<void>> {
  const adminToken = randomBytes(24).toString("hex");
  const provider = await startMockProvider();
  const runtime = await startRuntime({ providerUrl: provider.url, adminToken });
  process.env["E2E_RUNTIME_URL"] = runtime.url;
  process.env["E2E_PROVIDER_URL"] = provider.url;
  process.env["E2E_ADMIN_TOKEN"] = adminToken;
  return async () => {
    await runtime.stop();
    await provider.close();
  };
}
