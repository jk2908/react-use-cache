# Changelog

All notable changes to `react-use-cache` are documented here.

## 0.1.2
- README additions and changes
- Type naming changes
- Add Transition example to Vite example app

## 0.1.1
README additions and changes.

## 0.1.0

Initial release.

A slight upgrade on a simple `Map` cache for `use(Promise)` in React 19.

### Added

- `useCache()` — reads the `Cache` instance and `cached` wrapper from
  `CacheProvider`
- `cached(fn, opts)` — wraps an async function with cache-aware dedupe
  - `key`, `invalidate`, `abort`, `peek` methods
  - Shorthand form: `cached(fn, 'user')`
- `useVersion(key)` — re-renders a component when a key is invalidated
- `Cache` class — the underlying `Map<string, Entry>` with:
  - LRU eviction (tunable `maxSize`, default 100)
  - Retries (global or per-call `retries`, default 3)
  - Backoff between retries (exponential or fixed, opt-in via `backoff: ms`)
  - Per-entry `AbortController`; aborted short-circuits retries and any
    in-flight wait
  - `invalidate(key)` and `invalidate(predicate)` for prefix-style drops
  - `clear()` to abort and notify every entry
- `CacheProvider`, the React 19 context provider with optional `globalOpts`
- `isCacheExecutionContext(ctx)` guard for fetchers that want to check the
  injected context
- `Cached<T>` utility type that strips `ExecutionContext` from the public signature