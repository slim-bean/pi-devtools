/** Narrow schema-derived values without assuming a particular host schema library. */
export function enumValue<const T extends string>(value: unknown, values: readonly T[], field: string): T {
  const match = values.find((candidate) => candidate === value);
  if (match === undefined) throw new Error(`Invalid ${field}: expected one of ${values.join(", ")}`);
  return match;
}
