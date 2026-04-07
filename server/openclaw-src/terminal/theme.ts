const ANSI = {
  reset: "\u001b[0m",
  dim: "\u001b[2m",
  green: "\u001b[32m",
  yellow: "\u001b[33m",
  blue: "\u001b[34m",
  red: "\u001b[31m",
};

function richEnabled(): boolean {
  return Boolean(process.stdout?.isTTY) && process.env.NO_COLOR !== "1";
}

function tint(code: string, value: string): string {
  if (!richEnabled()) return value;
  return `${code}${value}${ANSI.reset}`;
}

export const theme = {
  success: (value: string) => tint(ANSI.green, value),
  warn: (value: string) => tint(ANSI.yellow, value),
  info: (value: string) => tint(ANSI.blue, value),
  error: (value: string) => tint(ANSI.red, value),
  muted: (value: string) => tint(ANSI.dim, value),
};

export function isRich(): boolean {
  return richEnabled();
}

export function colorize(rich: boolean, formatter: (value: string) => string, value: string): string {
  return rich ? formatter(value) : value;
}
