---
"@jk2908/react-use-cache": minor
---

Fix eviction aborting in-flight reads, `abort()` keeping the entry until settlement, predicate invalidation missing subscribers whose entry had been evicted, and `store()` not notifying subscribers.

Rename `ExecutionContext` to `CacheExecutionContext`, and export `isCacheExecutionContext` and `createCacheKey`.
