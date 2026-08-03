export const CACHED = Symbol('cached')

export function isCacheExecutionContext(arg: unknown): arg is Cache.ExecutionContext {
	return typeof arg === 'object' && arg !== null && CACHED in arg && arg[CACHED] === true
}

export namespace Cache {
	export type BackoffStrategy = 'exponential' | 'fixed'

	export type GlobalOptions = {
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
	}

	export type Cache = Map<string, Entry>

	export type Entry = {
		p: Promise<unknown>
		key: string
		controller: AbortController
	} & EntryOptions

	export type EntryOptions = {
		retries?: number
		backoff?: number
		backoffStrategy?: BackoffStrategy
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
} as const

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
	 * @param key - The key to set the cached promise for.
	 * @param promise - The promise to cache.
	 * @param opts - Optional entry options.
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

			if (lru !== undefined) {
				// abort any in-flight entry before evicting so that work
				// doesn't keep running silently once it's unobservable
				this.peek(lru)?.controller.abort()
				this.cache.delete(lru)
				this.#subscriptions.delete(lru)
			}
		}

		this.cache.set(key, { p: promise, key, controller, ...opts })
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

		this.#set<T>(key, p, controller, opts)

		return p
	}

	/**
	 * Abort a cached promise for the given key. If the entry exists, its associated
	 * AbortController will be triggered, and the entry will be removed from the
	 * cache once the promise settles.
	 *
	 * @param key - The key to abort the cached promise for.
	 * @returns True if the entry was aborted, false if it didn't exist.
	 */
	abort(key: string) {
		const entry = this.peek(key)
		if (!entry) return false

		entry.controller.abort()

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
	 * all subscribers.
	 *
	 * @param input - The key to invalidate, or a predicate function to match keys to invalidate.
	 *
	 * @example
	 * ```ts
	 * cache.invalidate('user:123') // invalidate a specific key
	 * cache.invalidate(key => key.startsWith('user:')) // invalidate all keys that start with 'user:'
	 * ```
	 */
	invalidate(input: string | ((key: string) => boolean)) {
		if (typeof input === 'string') {
			this.delete(input)
			this.bump(input)
			return
		}

		for (const key of this.cache.keys()) {
			if (input(key)) {
				this.delete(key)
				this.bump(key)
			}
		}
	}
}
