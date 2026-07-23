/**
 * Tiny in-process stale-while-revalidate cache for read routes whose payload
 * changes slowly (today: the PUBLIC programs directory). Purpose-built for the
 * shared Aurora cluster's auto-pause: while the database resumes (~30s), a
 * cached route serves its last-good response INSTANTLY — seat counts at most a
 * refresh stale — instead of a spinner ending in a 500.
 *
 * Semantics: fresh hit → cached value; expired hit → cached value NOW + one
 * deduped background revalidation; miss → compute (rides the
 * aurora-resume-retry extension, the backstop for a cold task + paused DB).
 * A failed compute serves the stale value at ANY age when one exists.
 *
 * Per-task memory only — nothing shared, nothing persisted; a scale-to-zero
 * relaunch starts empty, which is correct (its data may be long stale).
 */
type Entry = { value: unknown; at: number };
const store = new Map<string, Entry>();
const inflight = new Map<string, Promise<void>>();

export async function staleWhileRevalidate<T>(
    key: string,
    freshMs: number,
    fn: () => Promise<T>,
): Promise<{ value: T; stale: boolean }> {
    const hit = store.get(key);
    if (hit && Date.now() - hit.at < freshMs) return { value: hit.value as T, stale: false };

    if (hit) {
        // Expired: answer from cache immediately; refresh once in the background.
        if (!inflight.has(key)) {
            const p = fn()
                .then((value) => { store.set(key, { value, at: Date.now() }); })
                .catch(() => { /* keep serving stale; the next request retries */ })
                .finally(() => { inflight.delete(key); });
            inflight.set(key, p);
        }
        return { value: hit.value as T, stale: true };
    }

    try {
        const value = await fn();
        store.set(key, { value, at: Date.now() });
        return { value, stale: false };
    } catch (error) {
        throw error; // no cache to fall back on — the caller's error path applies
    }
}

/** Test hook. */
export function clearStaleCache() {
    store.clear();
    inflight.clear();
}
