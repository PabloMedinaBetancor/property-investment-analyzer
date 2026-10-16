// Twelve significant digits drop the binary noise of 0.07 * 100 without touching any real input.
const clean = (x: number) => Number(x.toPrecision(12));

export const toPercent = (rate: number) => clean(rate * 100);

export const fromPercent = (percent: number) => clean(percent / 100);
