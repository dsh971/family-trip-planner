// In-process LRU-style cache for WG CLI results.
// Keyed by (command, anchorName, flags) — scoped to the lifetime of the process.

const cache = new Map<string, unknown>();

export function cacheKey(command: string, anchorName: string, flags: string): string {
  return `${command}|${anchorName}|${flags}`;
}

export function getFromCache<T>(key: string): T | undefined {
  return cache.get(key) as T | undefined;
}

export function setInCache<T>(key: string, value: T): void {
  cache.set(key, value);
}

// Exposed for testing only
export function clearCache(): void {
  cache.clear();
}
