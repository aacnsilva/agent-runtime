export type Version = readonly [number, number, number];

const SHAPE = /^(\d{1,3})\.(\d{1,3})(?:\.(\d{1,3}))?$/;

export const parseVersion = (text: string): Version | null => {
  const match = SHAPE.exec(text);
  return match === null ? null : [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
};

export const isBefore = (left: Version, right: Version): boolean => {
  for (const index of [0, 1, 2] as const) {
    if (left[index] !== right[index]) {
      return left[index] < right[index];
    }
  }
  return false;
};
