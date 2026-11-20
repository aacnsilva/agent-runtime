export const logEvent = (name: string, fields: Record<string, unknown>): void => {
  console.log(JSON.stringify({ event: name, ...fields }));
};
