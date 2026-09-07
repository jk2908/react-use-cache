export const CACHED = Symbol('cached')

export function isCacheExecutionContext(arg: unknown): arg is Cache.ExecutionContext {
	return typeof arg === 'object' && arg !== null && CACHED in arg && arg[CACHED] === true
}

export namespace Cache {
	export type BackoffStrategy = 'exponential' | 'fixed'

	export type GlobalOptions = {
		/**
		 * The maximum number of entries to keep in the cache. Must be at least `1`.
		 */
		maxSize: number
		retries: number
		/**
		 * Delay in milliseconds between retry attempts. `0` (the default) means
		 * retries happen back-to-back with no wait.
		 */
		backoff: number
		/**
		 * How `backoff` scales across attempts. `'exponential'` (the default)
		 * doubles the delay after each failure; `'fixed'` holds it steady.
		 */
		backoffStrategy: BackoffStrategy
		/**
		 * Whether to keep an entry in the cache after its promise rejects.
		 * Defaults to `true`. Pinning the rejected promise is required for
		 * Suspense: when a render suspends on a rejected promise, React re-throws
		 * that rejection into an `ErrorBoundary`, which only works if the same
		 * promise is returned on the retried render. Evicting errors means every
		 * re-render produces a fresh promise that re-suspends forever.
		 *
		 * Set to `false` for imperative (non-render) reads — event handlers,
		 * service layers — where you want the next read to re-run the function
		 * rather than return a stale rejection. Don't combine it with
		 * `use(promise)` in a component.
		 */
		cacheErrors: boolean
		/**
		 * Whether `abort()` is permitted to cancel an entry whose key still has
		 * more than one subscriber (i.e. it's shared between mounted consumers).
		 * Defaults to `true` (backwards compatible): `abort()` always runs and
		 * just dev-warns when it's about to cancel shared work. Set to `false`
		 * to make `abort()` refuse — returning `false` instead — when the key
		 * has more than one subscriber.
		 *
		 * Consumers are counted via `subscribe`/`useVersion`; a component that
		 * renders a bare `use(promise)` without subscribing is invisible to this
		 * guard.
		 */
		allowSharedAbort: boolean
	}

	export type Cache = Map<string, Entry>

	export type Entry = {
		p: Promise<unknown>
		key: string
		controller: AbortController
		/**
		 * Whether the promise has settled. Used so `abort` can drop a settled
		 * entry synchronously instead of waiting for its `finally`.
		 */
		settled: boolean
	} & EntryOptions

	export type EntryOptions = {
		retries?: number
		backoff?: number
		backoffStrategy?: BackoffStrategy
		cacheErrors?: boolean
		allowSharedAbort?: boolean
	}

	export type Subscription = {
		version: number
		listeners: Set<() => void>
	}

	export type ExecutionContext = {
		readonly [CACHED]: true
		readonly signal: AbortSignal
	}
}

const DEFAULT_GLOBAL_OPTIONS = {
	maxSize: 100,
	retries: 3,
	backoff: 0,
	backoffStrategy: 'exponential',
	cacheErrors: true,
	allowSharedAbort: true,
} as const

/**
 * Warn only in development. The shared-abort checks are diagnostics, not user
 * errors that should spam production consoles.
 */
function devWarn(message: string) {
	if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'production') return

	console.warn(message)
}

export class Cache {
	/**
	 * The internal cache, mapping keys to cached entries
	 */
	cache: Cache.Cache = new Map()

	/**
	 * The global options for the cache, such as the maximum size
	 */
	opts: Cache.GlobalOptions = DEFAULT_GLOBAL_OPTIONS

	/**
	 * The subscriptions for each key, allowing consumers to subscribe to changes in
	 * the cached data
	 */
	#subscriptions = new Map<string, Cache.Subscription>()

	constructor(opts?: Partial<Cache.GlobalOptions>) {
		this.opts = { ...DEFAULT_GLOBAL_OPTIONS, ...opts }

		if (this.opts.maxSize < 1) {
			throw new RangeError('Cache maxSize must be at least 1')
		}
	}

	get size() {
		return this.cache.size
	}

	/**
	 * Get a cached promise for the given key. Promotes the entry to the most
	 * recently used position in the cache.
	 *
	 * @param key - The key to retrieve the cached promise for.
	 * @returns The cached promise, or undefined if it doesn't exist.
	 */
	#get(key: string) {
		const cached = this.peek(key)

		if (cached) {
			const { p, controller, ...rest } = cached
			this.#set(key, p, controller, rest)
		}

		return cached
	}

	/**
	 * Peek at a cached promise for the given key without promoting it to the most
	 * recently used position in the cache.
	 *
	 * @param key - The key to peek at the cached promise for.
	 * @returns The cached promise, or undefined if it doesn't exist.
	 */
	peek(key: string) {
		return this.cache.get(key)
	}

	/**
	 * Check if a cached promise exists for the given key.
	 *
	 * @param key - The key to check for a cached promise.
	 * @returns True if a cached promise exists for the key, false otherwise.
	 */
	has(key: string) {
		return this.peek(key) !== undefined
	}

	/**
	 * Set a cached promise for the given key. If the cache is full, the least recently
	 * used entry will be evicted.
	 *
	 * An evicted entry is only aborted if nobody is still subscribed to its key — a
	 * live `useVersion` subscriber may still be observing the promise, so cancelling
	 * it would reject their in-flight work out from under them. The subscription slot
	 * is left intact; eviction doesn't reset version counters.
	 *
	 * @param key - The key to set the cached promise for.
	 * @param promise - The promise to cache.
	 * @param opts - Optional entry options.
	 * @returns The newly created entry.
	 */
	#set<T>(
		key: string,
		promise: Promise<T>,
		controller: AbortController,
		opts: Cache.EntryOptions = {},
	) {
		// drop any existing entry
		this.cache.delete(key)

		while (this.size >= this.opts.maxSize) {
			const lru = this.cache.keys().next().value

			// maxSize is validated to be >= 1, so a cache that's over capacity is
			// guaranteed non-empty
			if (lru !== undefined) {
				const entry = this.peek(lru)

				if (entry && !this.#subscriptions.has(lru)) {
					entry.controller.abort()
				}

				this.cache.delete(lru)
			} else {
				// defensive: normally unreachable, but if user code emptied
				// `this.cache` mid-loop, break instead of spinning
				break
			}
		}

		const entry: Cache.Entry = { p: promise, key, controller, settled: false, ...opts }

		this.cache.set(key, entry)

		return entry
	}

	/**
	 * Get a cached promise for the given key, or create a new one if it doesn't exist.
	 * Initial reads will attempt the function and retry up to `opts.retries` times,
	 * waiting `opts.backoff` milliseconds between attempts (scaled by
	 * `opts.backoffStrategy`). `AbortError`s short-circuit both the
	 * retry loop and any in-flight wait.
	 *
	 * @param key - The key to retrieve or create the cached promise for.
	 * @param fn - The function to create a new promise if it doesn't exist in the cache.
	 * @param opts - Optional entry options.
	 *
	 * @returns The cached or newly created promise.
	 */
	read<T>(
		key: string,
		fn: (ctx: Cache.ExecutionContext) => Promise<T>,
		opts: Cache.EntryOptions = {},
	) {
		const existing = this.#get(key)
		if (existing) return existing.p as Promise<T>

		const controller = new AbortController()

		const ctx: Cache.ExecutionContext = {
			[CACHED]: true,
			signal: controller.signal,
		}

		const retries = opts.retries ?? this.opts.retries
		const backoff = opts.backoff ?? this.opts.backoff
		const strategy = opts.backoffStrategy ?? this.opts.backoffStrategy

		function wait(attempt: number) {
			return backoff <= 0
				? 0
				: strategy === 'exponential'
					? backoff * 2 ** attempt
					: backoff
		}

		const p = (async () => {
			let lastError: unknown

			for (let i = 0; i <= retries; i++) {
				try {
					return await fn(ctx)
				} catch (err) {
					if (err instanceof DOMException && err.name === 'AbortError') {
						throw err
					}

					lastError = err
					if (i === retries) throw err

					const delay = wait(i)

					if (delay > 0) {
						await new Promise<void>(resolve => {
							if (controller.signal.aborted) return resolve()

							let timer: ReturnType<typeof setTimeout>

							const onAbort = () => {
								clearTimeout(timer)
								resolve()
							}

							timer = setTimeout(() => {
								controller.signal.removeEventListener('abort', onAbort)
								resolve()
							}, delay)

							controller.signal.addEventListener('abort', onAbort, { once: true })
						})

						if (controller.signal.aborted) {
							throw new DOMException('Aborted', 'AbortError')
						}
					}
				}
			}

			throw lastError
		})()

		const entry = this.#set<T>(key, p, controller, opts)

		// once the promise settles, mark the entry as done so `abort()` can remove
		// a finished entry instantly
		p.finally(() => {
			if (this.cache.get(key) === entry) entry.settled = true
		}).catch(() => {}) // swallow the mirrored rejection of the child promise

		// errors are kept in the cache by default (required for `React.use()` compat).
		// With `cacheErrors: false` the entry sweeps itself out on failure so the next
		// read re-runs the function instead of returning a stale rejection. Only if
		// the key still holds this exact promise
		if (!(opts.cacheErrors ?? this.opts.cacheErrors)) {
			p.catch(() => {
				if (this.cache.get(key)?.p === p) this.delete(key)
			})
		}

		return p
	}

	/**
	 * Abort a cached promise for the given key. If the entry exists, its associated
	 * AbortController will be triggered, and the entry will be removed from the
	 * cache. Settled entries are removed synchronously; in-flight entries are
	 * removed once their promise settles.
	 *
	 * By default this always runs. When the key still has more than one
	 * subscriber, the abort is cancelling work another mounted consumer is
	 * waiting on, so a development warning is emitted — set `allowSharedAbort:
	 * false` on the entry to make it refuse (return `false`) in that case.
	 *
	 * @param key - The key to abort the cached promise for.
	 * @returns True if the entry was aborted, false if it didn't exist or was refused.
	 */
	abort(key: string) {
		const entry = this.peek(key)
		if (!entry) return false

		const allowShared = entry.allowSharedAbort ?? this.opts.allowSharedAbort
		const watchers = this.#subscriptions.get(key)?.listeners.size ?? 0

		if (watchers > 1) {
			devWarn(
				`[react-use-cache] abort("${key}") is cancelling a request ${watchers} subscribers are still using. ` +
					(allowShared
						? 'It proceeded anyway; set allowSharedAbort: false on the cached() call to refuse.'
						: 'The abort was refused. Set allowSharedAbort: true to force it.'),
			)

			if (!allowShared) return false
		}

		entry.controller.abort()

		if (entry.settled) {
			this.delete(key)
			return true
		}

		entry.p
			.finally(() => {
				if (this.peek(key)?.p === entry.p) {
					this.delete(key)
				}
			})
			.catch(() => {})

		return true
	}

	/**
	 * Delete a cached promise for the given key. If the entry exists, it will be removed
	 * from the cache.
	 *
	 * @param key - The key to delete the cached promise for.
	 * @returns True if the entry was deleted, false if it didn't exist.
	 */
	delete(key: string) {
		const entry = this.cache.get(key)
		if (!entry) return false

		this.cache.delete(key)

		return true
	}

	/**
	 * Clear the entire cache, removing all entries and notifying the subscriber
	 * of each cleared key. The subscription map is bounded by active subscribers
	 * (see {@link subscribe}), so no separate sweep is needed here.
	 *
	 * @returns The number of entries that were removed from the cache.
	 */
	clear() {
		const entries = [...this.cache.values()]

		for (const entry of entries) {
			entry.controller.abort()
			this.cache.delete(entry.key)
			this.bump(entry.key)
		}

		return entries.length
	}

	/**
	 * Get the current version number for the given key. The version is incremented
	 * each time the key is invalidated, so consumers can detect changes to the
	 * cached data. A version counter only exists while the key has a live
	 * subscriber (see {@link subscribe}); keys with no slot read `0`.
	 *
	 * @param key - The key to retrieve the version number for.
	 * @returns The current version number for the key, or `0` if it has no subscriber.
	 */
	version(key: string) {
		return this.#subscriptions.get(key)?.version ?? 0
	}

	/**
	 * Subscribe to changes for the given key. The callback fires whenever the key
	 * is invalidated. Unsubscribing the last listener drops the slot entirely,
	 * so the subscription map is bounded by the number of mounted subscribers.
	 *
	 * Subscribers double as the cache's notion of "consumers": `abort()` checks
	 * the subscriber count to decide whether cancelling a key is cancelling work
	 * other consumers still need.
	 *
	 * @param key - The key to subscribe to changes for.
	 * @param cb - The callback to call when the entry is invalidated.
	 * @returns A function to unsubscribe from changes for the key.
	 */
	subscribe(key: string, cb: () => void) {
		let sub = this.#subscriptions.get(key)

		if (!sub) {
			sub = {
				version: 0,
				listeners: new Set(),
			}
			this.#subscriptions.set(key, sub)
		}

		sub.listeners.add(cb)

		return () => {
			sub.listeners.delete(cb)

			if (sub.listeners.size === 0) {
				this.#subscriptions.delete(key)
			}
		}
	}

	/**
	 * Increment the version number for the given key and notify all subscribers.
	 * Called when an entry is invalidated. No-ops when the key has no live
	 * subscriber, so invalidating a key nobody is watching costs nothing.
	 *
	 * @param key - The key to bump the version number for.
	 */
	bump(key: string) {
		const sub = this.#subscriptions.get(key)
		if (!sub) return

		sub.version++
		sub.listeners.forEach(cb => cb())
	}

	/**
	 * Invalidate the cached promise for the given key, or all keys that match the provided predicate.
	 * This will remove the entry from the cache and increment the version number, notifying
	 * all subscribers. Pass `{ abort: true }` to also abort any in-flight entry — use this
	 * when invalidating to refresh, so the old request is cancelled rather than left running
	 * in parallel with the new one.
	 *
	 * @param input - The key to invalidate, or a predicate function to match keys to invalidate.
	 * @param opts - Optional invalidation options.
	 *
	 * @example
	 * ```ts
	 * cache.invalidate('user:123') // invalidate a specific key
	 * cache.invalidate(key => key.startsWith('user:')) // invalidate all keys that start with 'user:'
	 * ```
	 */
	invalidate(input: string | ((key: string) => boolean), opts?: { abort?: boolean }) {
		const drop = (key: string) => {
			if (opts?.abort) {
				this.abort(key)
				// abort drops settled entries immediately, but an in-flight entry is
				// only removed once its promise settles — delete it now so the next
				// read starts fresh instead of grabbing the dying entry
				this.delete(key)
			} else {
				this.delete(key)
			}

			this.bump(key)
		}

		if (typeof input === 'string') {
			drop(input)
			return
		}

		for (const key of this.cache.keys()) {
			if (input(key)) {
				drop(key)
			}
		}
	}
}
