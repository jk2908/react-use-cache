# react-use-cache

A slight upgrade on a simple `Map` cache for `use(Promise)` in React 19.

```tsx
import { Suspense, use } from 'react'
import { CacheProvider, useCache } from 'react-use-cache'

async function fetchUser(id, { signal }) {
  const res = await fetch(`/api/users/${id}`, { signal })
  return res.json()
}

function App() {
  return (
    <CacheProvider>
      <Suspense fallback={<p>Loading…</p>}>
        <User id="1" />
        <User id="1" /> {/* deduped fetch runs once */}
      </Suspense>
    </CacheProvider>
  )
}

function User({ id }) {
  const { cached } = useCache()
  const getUser = cached(fetchUser, { key: 'user' })
  const user = use(getUser(id))

  return <p>{user.name}</p>
}
```

- Dedupe across sibling components
- Retries with optional backoff (exponential or fixed)
- Abort per entry
- LRU eviction with a customisable `maxSize`
- `useVersion(key)` - re-render a component when a key is invalidated

## API

### `CacheProvider`

```tsx
<CacheProvider globalOpts={{ maxSize: 100, retries: 3 }}>
  {children}
</CacheProvider>
```

Creates a single `Cache` instance for the React tree. 

### `useCache()`

```tsx
const { cache, cached } = useCache()
```

Returns the live `Cache` instance and the `cached` wrapper.

### `cached(fn, opts)`

Wraps an async function in a cache-aware version.

```ts
const getUser = cached(fetchUser, {
  key: 'user', // prefix for cache keys
  retries: 3, // optional per-function override of the global budget
  backoff: 100, // optional ms delay between retries; default 0 (no delay)
  backoffStrategy: 'exponential', // 'exponential' (default) | 'fixed'
})
```

Shorthand: `cached(fetchUser, 'user')` accepts a bare string when you don't need other options. Pass `ExecutionContext` as the last parameter to gain access to an `AbortSignal`:

```ts
async function fetchUser(id: string, { signal }: ExecutionContext) { … }

type GetUser = Cached<typeof fetchUser> // (id: string) => Promise<User>
```

`Cached` strips `ExecutionContext` off the end of the param list - the cache passes it in for you, so the public signature just has the user-facing args. The returned function resolves to whatever your function returns.

The returned function has a few attached methods:

| method                        | description                                       |
| ----------------------------- | ------------------------------------------------- |
| `getUser.key(...args)`        | the full cache key for these args                 |
| `getUser.invalidate(...args)` | drop the entry & notify `useVersion` subscribers  |
| `getUser.abort(...args)`      | abort an in-flight entry; returns `boolean`       |
| `getUser.peek(...args)`       | read the entry without promoting it (no LRU bump) |

> **Note:** `cached(fn, opts)` returns a fresh function on every call, so don't
> rely on a stable identity. Calling it inside render (as above) is fine since
> `Cache` dedupes by key, not by reference. If a consumer needs a stable
> reference, wrap it:
>
> ```ts
> const getUser = useMemo(() => cached(fetchUser, { key: 'user' }), [cached])
> ```
>
> The `cached` wrapper returned by `useCache()` has a stable identity — 
> `CacheProvider` creates it once for the lifetime of the `Cache` instance — so
> memoising with `[cached]` as the dependency keeps the wrapped function stable
> across re-renders.

### `useVersion(key)`

```tsx
const version = useVersion(getUser.key(id))
```

Re-renders the component whenever `key` is invalidated. Pair it with
`getUser.invalidate(...)` to refresh a mounted subtree after a mutation.

The re-render happens whether or not you read the returned `version` — the
subscription alone drives it. The value only matters for what you pass it into:

- **Ignore it** → the component just re-renders. Existing instances keep their
  local state:

  ```tsx
  function App({ id }) {
    useVersion(getUser.key(id))
    const user = use(getUser(id))
    return <User user={user} /> // state preserved across refreshes
  }
  ```

- **Use it as a `key`** → the keyed child remounts whenever the version
  changes (i.e. every invalidation), resetting its state:

  ```tsx
  function App({ id }) {
    const version = useVersion(getUser.key(id))
    const user = use(getUser(id))
    return <User key={version} user={user} /> // remounts on each refresh
  }
  ```

Use the `key` form when a refresh represents a new resource and its subtree
should start clean, e.g. a document editor remounting the editor when a freshly
saved draft is loaded. Otherwise prefer ignoring the value so child components
keep their state.

### `Cache`

The class is also exported directly, for tests or non-React code. See
`isCacheExecutionContext` for checking the abort context inside a fetcher.

## Patterns

### Refresh after mutation

Once `use(getUser(id))` has resolved, it won't re-read on its own. `invalidate`
drops the cache entry and bumps the version so to make the same component
re-fetch, subscribe to the version. The bump triggers a re-render; since the
entry was deleted, `getUser(id)` returns a fresh pending promise that
re-suspends:

```tsx
function User({ id }) {
  useVersion(`user:${id}`)
  const { cached } = useCache()
  const getUser = cached(fetchUser, { key: 'user' })
  const user = use(getUser(id))

  return (
    <>
      <p>{user.name}</p>
      <button onClick={() => getUser.invalidate(id)}>Refresh</button>
    </>
  )
}
```

Alternatively, lift the promise into the parent and pass it as a prop. The
parent subscribes to the version and creates the promise; the child just
renders it. On invalidate, the bump triggers a re-render, `getUser(id)` returns
a fresh promise (the entry was deleted), and the child's `use(promise)`
re-suspends:

```tsx
function App({ id }) {
  const version = useVersion(`user:${id}`)
  const { cached } = useCache()
  const getUser = cached(fetchUser, { key: 'user' })
  return <User key={version} promise={getUser(id)} />
}

function User({ promise }: { promise: Promise<User> }) {
  const user = use(promise)
  return <p>{user.name}</p>
}
```

### Abort on unmount

```tsx
function User({ id }) {
  const { cached } = useCache()
  const getUser = cached(fetchUser, { key: 'user' })

  useEffect(() => () => getUser.abort(id), [id])

  const user = use(getUser(id))
  return <p>{user.name}</p>
}
```

### Retries with backoff

```ts
const getUser = cached(fetchUser, {
  key: 'user',
  retries: 3,
  backoff: 100, // ms
  backoffStrategy: 'exponential', // or 'fixed'
})
```

The cache retries the underlying function up to `retries` times, waiting
`backoff` ms between attempts. The `'exponential'` strategy doubles the delay
after each failure (`100 → 200 → 400 …`); `'fixed'` holds it steady at
`backoff`. Pass `backoff: 0` (the default) to retry back-to-back with no wait.

### Prefix invalidation

```ts
// drop every cached entry whose key starts with 'user:'
cache.invalidate(key => key.startsWith('user:'))
```

`invalidate` accepts a predicate, so prefix-style invalidation needs no extra
API. Every matching key is dropped and its version bumped, notifying any
`useVersion` subscribers.

## License

MIT