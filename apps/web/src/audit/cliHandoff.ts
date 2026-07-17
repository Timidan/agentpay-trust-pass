export function shellArgument(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}
