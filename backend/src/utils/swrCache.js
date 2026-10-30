/**
 * Stale-While-Revalidate (SWR) in-memory cache for RouteWatch.
 *
 * Returns cached results immediately (0ms). If the cached data is older than
 * ttlMs, it serves the stale copy while revalidating in the background.
 * Automatically invalidates or marks stale when incidents change.
 */

class SwrCache {
  constructor() {
    this.store = new Map();
    this.revalidating = new Set();
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) return null;
    const now = Date.now();
    if (now > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry;
  }

  set(key, data, ttlMs = 60000, maxAgeMs = 600000) {
    const now = Date.now();
    this.store.set(key, {
      data,
      staleAt: now + ttlMs,
      expiresAt: now + maxAgeMs,
      createdAt: now,
    });
  }

  async getOrRevalidate(key, fetcher, ttlMs = 60000, maxAgeMs = 600000) {
    const entry = this.get(key);
    const now = Date.now();

    if (entry) {
      if (now > entry.staleAt && !this.revalidating.has(key)) {
        this.revalidating.add(key);
        Promise.resolve().then(async () => {
          try {
            const fresh = await fetcher();
            this.set(key, fresh, ttlMs, maxAgeMs);
          } catch (e) {
            // Keep serving stale data on revalidation error
          } finally {
            this.revalidating.delete(key);
          }
        });
      }
      return entry.data;
    }

    // No cache entry — fetch synchronously
    const fresh = await fetcher();
    this.set(key, fresh, ttlMs, maxAgeMs);
    return fresh;
  }

  invalidate(prefix = '') {
    if (!prefix) {
      this.store.clear();
      return;
    }
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
      }
    }
  }

  clear() {
    this.store.clear();
  }
}

const swrCache = new SwrCache();

module.exports = swrCache;

