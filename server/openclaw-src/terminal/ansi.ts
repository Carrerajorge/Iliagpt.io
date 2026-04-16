const ANSI_RE =
  // Matches standard ANSI escape/control sequences.
  // Based on the common strip-ansi pattern, trimmed for local use here.
  // eslint-disable-next-line no-control-regex
  /[\u001B\u009B][[\]()#;?]*(?:(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nq-uy=><~])/g;

export function stripAnsi(value: string): string {
  return value.replace(ANSI_RE, "");
}
