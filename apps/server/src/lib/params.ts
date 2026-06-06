export function p(params: Record<string, any>, key: string): string {
  return String(params[key] ?? "");
}
