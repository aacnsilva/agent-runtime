import { describe, expect, it } from "vitest";

import source from "../wrangler.jsonc?raw";

interface Binding {
  name: string;
  class_name: string;
}

interface Deployment {
  name: string;
  durable_objects: { bindings: Binding[] };
}

interface Config extends Deployment {
  migrations: { new_sqlite_classes: string[] }[];
  env: Record<string, Deployment>;
}

const TRAILING_COMMA = /,(\s*[}\]])/g;

const config = JSON.parse(source.replace(TRAILING_COMMA, "$1")) as Config;

describe("worker configuration", () => {
  it("gives the dev deployment its own name and every store production has", () => {
    const dev = config.env["dev"];
    expect(dev?.name).toBe("agent-runtime-dev");
    expect(dev?.name).not.toBe(config.name);
    expect(dev?.durable_objects.bindings).toEqual(config.durable_objects.bindings);
  });

  it("creates every bound store class in a migration", () => {
    const created = config.migrations.flatMap((migration) => migration.new_sqlite_classes);
    const bound = config.durable_objects.bindings.map((binding) => binding.class_name);
    expect([...created].sort()).toEqual([...bound].sort());
  });

  it("keeps secrets out of the configuration", () => {
    expect(JSON.stringify(config)).not.toMatch(/API_KEY|ADMIN_TOKEN|secret/i);
  });
});
