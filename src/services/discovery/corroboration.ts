function tokenize(s: string): string[] {
  return s
    .replace(/-/g, " ")
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .split(/\s+/)
    .filter(Boolean);
}

export function tokenOverlap(a: string, b: string): number {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.length === 0 || tb.length === 0) return 0;
  const [shorter, longer] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const matches = shorter.filter((t) => longer.includes(t)).length;
  return matches / shorter.length;
}

export function namesMatch(a: string, b: string): boolean {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.length < 2 || tb.length < 2) {
    return ta.join(" ") === tb.join(" ");
  }
  return tokenOverlap(a, b) >= 0.6;
}

export function buildSources(placeName: string, wgNames: string[], tabelogNames: string[]): string[] {
  const sources: string[] = ["google-places-text-search"];
  if (wgNames.some((wgName) => namesMatch(placeName, wgName))) {
    sources.push("wanderlust-goat");
  }
  if (tabelogNames.some((tName) => namesMatch(placeName, tName))) {
    sources.push("tabelog");
  }
  return sources;
}

export function corroborationScore(sources: string[]): number {
  return sources.length;
}
