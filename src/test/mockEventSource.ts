// Shared test-only EventSource stub (jsdom has no native EventSource — see
// plan 2026-08-20-011 U7's testing guidance). Mirrors only the minimal
// surface src/components/ui/useResearchStream.ts actually touches:
// addEventListener per named SSE event, an assignable `onerror`, and
// `close()`. Not a full EventSource spec implementation by design.
export class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  closed = false;
  onerror: ((evt: unknown) => void) | null = null;
  private listeners = new Map<string, Array<(evt: unknown) => void>>();

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(name: string, handler: (evt: unknown) => void) {
    const arr = this.listeners.get(name) ?? [];
    arr.push(handler);
    this.listeners.set(name, arr);
  }

  close() {
    this.closed = true;
  }

  /** Simulate the server emitting a named SSE event (event: name / data: json). */
  emit(name: string, data: unknown) {
    const payload = { data: JSON.stringify(data) };
    for (const handler of this.listeners.get(name) ?? []) handler(payload);
  }

  /** Simulate a genuine connection-level failure (a plain Event, no .data). */
  emitConnectionError() {
    this.onerror?.({});
  }

  /** Simulate the server's own terminal `event: error` frame (a MessageEvent, has .data). */
  emitNamedError(data: { message?: string }) {
    const payload = { data: JSON.stringify(data) };
    this.onerror?.(payload);
  }
}

/** Installs the stub as `globalThis.EventSource` and resets the instance log. */
export function installMockEventSource(): void {
  MockEventSource.instances = [];
  (globalThis as unknown as { EventSource: unknown }).EventSource = MockEventSource;
}

export function latestEventSource(): MockEventSource {
  const inst = MockEventSource.instances[MockEventSource.instances.length - 1];
  if (!inst) throw new Error("no MockEventSource instance created");
  return inst;
}

export function eventSourcesFor(urlSubstring: string): MockEventSource[] {
  return MockEventSource.instances.filter((i) => i.url.includes(urlSubstring));
}
