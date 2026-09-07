# Changelog

All notable changes to `react-use-cache` are documented here.

## 0.2.0

### Added

- `cached.refresh(...args)` - invalidate a key *and* abort any in-flight
  request in one call, so a refresh never leaves the old request running in
  parallel with the new one (also available as
  `Cache.invalidate(key | predicate, { abort: true })`).
- `allowSharedAbort` option (global or per-call, default `true`). `abort()` on
  a key that more than one subscriber is still using emits a development-only
  warning (it still proceeds, keeping backwards compatibility). Set
  `allowSharedAbort: false` to make `abort()` *refuse* in that case - it
  returns `false` and leaves the request running. Consumers are counted via
  `useVersion`/`cache.subscribe`; bare `use(promise)` components aren't tracked.
- `cacheErrors` option (global or per-call). Defaults to `true`; set `false` to
  evict rejected promises as soon as they settle so the next read re-runs the
  function. Intended for imperative reads - pinning the rejection is required
  for Suspense, since an `ErrorBoundary` only settles when the *same* rejected
  promise is re-thrown on the retried render.

### Changed

- **Cache keys are now unambiguous.** Every argument is serialised (`devalue`)
  rather than `String()`-coerced, so `1`, `'1'`, `1n`, `0` vs `-0`, and
  `null` vs `undefined` no longer collide. Use `getUser.key(id)` (or the
  equivalent on `cached` consumers) to get the exact key for `useVersion` and
  the raw `Cache` methods. Existing literal keys are unchanged semantically.
- **Unserialisable values now throw.** Arguments you can't key on reliably
  (functions, symbols) throw instead of producing misleading keys.
- **Eviction no longer cancels watched requests.** An LRU-evicted entry is only
  aborted if no `useVersion` subscriber is observing its key; otherwise it is
  dropped from the cache but left to finish.
- **Version slots persist across eviction.** Previously eviction deleted the
  subscription slot, resetting a `useVersion` component's counter to `0`; the
  slot is now owned by `subscribe`/`unsubscribe` alone.
- `Cache` now throws `RangeError` when `maxSize < 1` instead of looping forever
  on the first insert.
- `Cache.abort` on a settled entry removes it synchronously instead of waiting
  for a `.finally()` microtask.
- The default `backoffStrategy` is now `'exponential'`, matching the documented
  default. It only matters when `backoff > 0` and no explicit strategy is set.

## 0.1.6
- Fix: `useVersion` now memoizes its `subscribe`/`getSnapshot` closures, so
  invalidations reliably bump the version and subscribers re-render. Passing
  fresh closures to `useSyncExternalStore` on every render caused React to
  tear down and re-create the subscription each render — and because
  `Cache.subscribe`'s cleanup deletes the version slot when the listener count
  reaches zero, the slot was recreated at version `0`, discarding
  `invalidate()` bumps before they could reach a commit.

## 0.1.5
- Fix: the Vite example referenced the package by its unscoped name
  (`react-use-cache`), so `bun install` failed with
  `react-use-cache@workspace:* failed to resolve`. It now depends on and
  imports the scoped `@jk2908/react-use-cache`.

## 0.1.4
- Docs: document the `useVersion(key)` re-render vs remount distinction — the
  re-render happens whether or not the returned version is read, but using it
  as a child `key` remounts the subtree (resetting state) instead of preserving
  existing instances.

## 0.1.3
- Fix: `CacheProvider` now creates its `cached` wrapper once for the lifetime
  of the `Cache` instance instead of on every render. The identity of `cached`
  is now stable, so `useMemo(() => cached(fn, opts), [cached])` in consumers
  is no longer defeated by a fresh `cached` reference on each render.

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