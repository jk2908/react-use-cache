---
"@jk2908/react-use-cache": minor
---

Fix eviction aborting in-flight reads, `abort()` keeping the entry until settlement, predicate invalidation missing subscribers whose entry had been evicted, and `store()` not notifying subscribers.

Rename `ExecutionContext` to `CacheExecutionContext`, and export `isCacheExecutionContext` and `createCacheKey`.

`peek()` now returns `Cache.EntryInfo`, a read-only view that omits the internal `AbortController` and option fields. `Cache.Store` is the map type, with `Cache.Cache` kept as a deprecated alias.

`cached()` accepts `keySerialiser` to replace `createCacheKey` for that wrapper.
