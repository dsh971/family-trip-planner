// Concurrency-limited batch processor.
//
// Promoted, unchanged in behavior, from src/app/api/discovery/route.ts's
// previously-local `withConcurrencyLimit` (plan 2026-08-20-011 U4) so both the
// legacy synchronous discovery route and the new async research runs (U5, U6)
// share one implementation instead of duplicating it.
//
// Scope note (see plan's Key Technical Decisions and Risks & Dependencies):
// this bounds parallelism WITHIN a single call — e.g. within one research
// run's per-place enrichment loop. It is NOT a cross-run limiter. Nothing
// here caps how many different destinations or neighborhoods are researched
// concurrently by separate, independently-started runs — that's an accepted,
// documented limitation for this plan. The mitigation this plan ships instead
// is per-IP rate limiting on the trigger routes (U3, U5, U6), which bounds how
// fast new runs can start, not how many run at once.
export async function withConcurrencyLimit<T>(
  items: T[],
  fn: (item: T) => Promise<unknown>,
  limit: number
): Promise<void> {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += limit) {
    chunks.push(items.slice(i, i + limit));
  }
  for (const chunk of chunks) {
    await Promise.all(chunk.map(fn));
  }
}
