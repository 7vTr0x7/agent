function dayOffsets(name: string, value: string): number[] {
  const offsets = value.split(",").map((item) => nonNegativeInteger(name, item.trim()));
  if (offsets.length === 0) {
    throw new Error(`${name} must contain strictly increasing non-negative integers`);
  }

  for (let index = 1; index < offsets.length; index += 1) {
    const previous = offsets[index - 1];
    const current = offsets[index];
    if (previous === undefined || current === undefined || current <= previous) {
      throw new Error(`${name} must contain strictly increasing non-negative integers`);
    }
  }

  return offsets;
}
