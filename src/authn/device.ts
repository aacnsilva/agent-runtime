export const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export interface DeviceKey {
  x: string;
  y: string;
}

export type DeviceEnvironment = "development" | "production";

export interface DeviceState {
  challenge: { nonce: string; expiresAt: number } | null;
  publicKey: DeviceKey | null;
  counter: number;
  environment: DeviceEnvironment;
}

export interface KnownDevice {
  publicKey: DeviceKey;
  counter: number;
  environment: DeviceEnvironment;
}

export interface DeviceStep<T> {
  state: DeviceState;
  result: T;
}

export const emptyDevice = (): DeviceState => ({
  challenge: null,
  publicKey: null,
  counter: 0,
  environment: "production",
});

export const putChallenge = (state: DeviceState, nonce: string, now: number): DeviceState => ({
  ...state,
  challenge: { nonce, expiresAt: now + CHALLENGE_TTL_MS },
});

export const takeChallenge = (state: DeviceState, now: number): DeviceStep<string | null> => {
  const { challenge } = state;
  const usable = challenge !== null && challenge.expiresAt > now;
  return { state: { ...state, challenge: null }, result: usable ? challenge.nonce : null };
};

export const putDevice = (
  state: DeviceState,
  publicKey: DeviceKey,
  environment: DeviceEnvironment,
): DeviceState => ({ ...state, publicKey, environment, challenge: null });

export const readDevice = (state: DeviceState): KnownDevice | null =>
  state.publicKey === null
    ? null
    : { publicKey: state.publicKey, counter: state.counter, environment: state.environment };

export const bumpCounter = (state: DeviceState, counter: number): DeviceStep<boolean> => {
  const accepted = state.publicKey !== null && Number.isInteger(counter) && counter > state.counter;
  return { state: accepted ? { ...state, counter } : state, result: accepted };
};
