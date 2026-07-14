interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  staleUntil: number;
}

export class MemoryCache {
  private readonly entries =
    new Map<string, CacheEntry<unknown>>();

  private readonly inFlight =
    new Map<string, Promise<unknown>>();

  constructor(
    private readonly maxEntries: number
  ) {}

  getFresh<T>(key: string): T | undefined {
    const entry = this.entries.get(key);

    if (!entry) {
      return undefined;
    }

    const now = Date.now();

    if (now >= entry.staleUntil) {
      this.entries.delete(key);
      return undefined;
    }

    this.touch(key, entry);

    if (now >= entry.expiresAt) {
      return undefined;
    }

    return entry.value as T;
  }

  getStale<T>(key: string): T | undefined {
    const entry = this.entries.get(key);

    if (!entry) {
      return undefined;
    }

    if (Date.now() >= entry.staleUntil) {
      this.entries.delete(key);
      return undefined;
    }

    this.touch(key, entry);

    return entry.value as T;
  }

  set<T>(
    key: string,
    value: T,
    ttlMs: number,
    staleTtlMs: number
  ): void {
    const now = Date.now();

    if (this.entries.has(key)) {
      this.entries.delete(key);
    }

    while (
      this.entries.size >= this.maxEntries
    ) {
      const oldestKey =
        this.entries.keys().next().value;

      if (typeof oldestKey !== 'string') {
        break;
      }

      this.entries.delete(oldestKey);
    }

    this.entries.set(key, {
      value,
      expiresAt: now + ttlMs,
      staleUntil: now + ttlMs + staleTtlMs,
    });
  }

  async getOrLoad<T>(
    key: string,
    ttlMs: number,
    staleTtlMs: number,
    loader: () => Promise<T>
  ): Promise<T> {
    const fresh = this.getFresh<T>(key);

    if (fresh !== undefined) {
      return fresh;
    }

    const existing =
      this.inFlight.get(key);

    if (existing) {
      return existing as Promise<T>;
    }

    let loadingPromise: Promise<T>;

    loadingPromise = loader()
      .then((value) => {
        this.set(
          key,
          value,
          ttlMs,
          staleTtlMs
        );

        return value;
      })
      .finally(() => {
        if (
          this.inFlight.get(key) ===
          loadingPromise
        ) {
          this.inFlight.delete(key);
        }
      });

    this.inFlight.set(
      key,
      loadingPromise
    );

    return loadingPromise;
  }

  clear(): void {
    this.entries.clear();
    this.inFlight.clear();
  }

  private touch(
    key: string,
    entry: CacheEntry<unknown>
  ): void {
    this.entries.delete(key);
    this.entries.set(key, entry);
  }
}