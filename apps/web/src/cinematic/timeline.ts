export const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));
export const lerp = (start: number, end: number, amount: number) => start + (end - start) * amount;
export const smoothstep = (value: number) => {
  const t = clamp(value);
  return t * t * (3 - 2 * t);
};
export const rangeProgress = (value: number, start: number, end: number) =>
  start === end ? Number(value >= end) : clamp((value - start) / (end - start));
export const segmentInOut = (
  value: number,
  enterStart: number,
  enterEnd: number,
  exitStart: number,
  exitEnd: number,
) =>
  smoothstep(rangeProgress(value, enterStart, enterEnd)) *
  (1 - smoothstep(rangeProgress(value, exitStart, exitEnd)));
