import { describe, expect, it } from "vitest";

import {
  bumpCounter,
  CHALLENGE_TTL_MS,
  emptyDevice,
  putChallenge,
  putDevice,
  readDevice,
  takeChallenge,
} from "../src/authn/device";

const KEY = { x: "x-coordinate", y: "y-coordinate" };

describe("device state", () => {
  it("hands a challenge out once, and only before it expires", () => {
    const waiting = putChallenge(emptyDevice(), "nonce", 1000);
    const taken = takeChallenge(waiting, 2000);
    expect(taken.result).toBe("nonce");
    expect(takeChallenge(taken.state, 2000).result).toBeNull();
    expect(takeChallenge(waiting, 1000 + CHALLENGE_TTL_MS).result).toBeNull();
  });

  it("is unknown until a key has been attested", () => {
    expect(readDevice(emptyDevice())).toBeNull();
    expect(bumpCounter(emptyDevice(), 1).result).toBe(false);
    const known = putDevice(emptyDevice(), KEY, "development");
    expect(readDevice(known)).toEqual({ publicKey: KEY, counter: 0, environment: "development" });
  });

  it("accepts only a counter higher than the last one", () => {
    const first = bumpCounter(putDevice(emptyDevice(), KEY, "production"), 1);
    expect(first.result).toBe(true);
    expect(bumpCounter(first.state, 1).result).toBe(false);
    expect(bumpCounter(first.state, 0).result).toBe(false);
    expect(bumpCounter(first.state, 1.5).result).toBe(false);
    expect(bumpCounter(first.state, 7).state.counter).toBe(7);
  });

  it("keeps the counter when the same key is attested again", () => {
    const used = bumpCounter(putDevice(emptyDevice(), KEY, "production"), 5).state;
    const again = putDevice(used, KEY, "production");
    expect(bumpCounter(again, 5).result).toBe(false);
  });
});
