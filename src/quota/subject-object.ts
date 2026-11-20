import { DurableObject } from "cloudflare:workers";

import type { DeviceEnvironment, DeviceKey, DeviceState, KnownDevice } from "../authn/device";
import {
  bumpCounter,
  emptyDevice,
  putChallenge,
  putDevice,
  readDevice,
  takeChallenge,
} from "../authn/device";
import type { Env } from "../env";
import type { QuotaBegin, QuotaGrant, QuotaRefund, QuotaRefusal, QuotaState } from "./subject";
import { beginQuota, emptyQuota, refundQuota, usedThisMonth } from "./subject";

const QUOTA_KEY = "quota";
const DEVICE_KEY = "device";

export class Subject extends DurableObject<Env> {
  private quota: QuotaState | undefined;

  async begin(input: QuotaBegin): Promise<QuotaGrant | QuotaRefusal> {
    const step = beginQuota(await this.load(), input);
    await this.store(step.state);
    return step.result;
  }

  async refund(input: QuotaRefund): Promise<void> {
    await this.store(refundQuota(await this.load(), input).state);
  }

  async used(now: number): Promise<number> {
    return usedThisMonth(await this.load(), now);
  }

  async putChallenge(nonce: string, now: number): Promise<void> {
    await this.storeDevice(putChallenge(await this.loadDevice(), nonce, now));
  }

  async takeChallenge(now: number): Promise<string | null> {
    const step = takeChallenge(await this.loadDevice(), now);
    await this.storeDevice(step.state);
    return step.result;
  }

  async putDevice(publicKey: DeviceKey, environment: DeviceEnvironment): Promise<void> {
    await this.storeDevice(putDevice(await this.loadDevice(), publicKey, environment));
  }

  async readDevice(): Promise<KnownDevice | null> {
    return readDevice(await this.loadDevice());
  }

  async bumpCounter(counter: number): Promise<boolean> {
    const step = bumpCounter(await this.loadDevice(), counter);
    await this.storeDevice(step.state);
    return step.result;
  }

  private async loadDevice(): Promise<DeviceState> {
    return (await this.ctx.storage.get<DeviceState>(DEVICE_KEY)) ?? emptyDevice();
  }

  private async storeDevice(state: DeviceState): Promise<void> {
    await this.ctx.storage.put(DEVICE_KEY, state);
  }

  private async load(): Promise<QuotaState> {
    this.quota ??= (await this.ctx.storage.get<QuotaState>(QUOTA_KEY)) ?? emptyQuota();
    return this.quota;
  }

  private async store(state: QuotaState): Promise<void> {
    this.quota = state;
    await this.ctx.storage.put(QUOTA_KEY, state);
  }
}
