import { createContext, useMemo, useState } from 'react'

import { Cache, devWarn } from './cache.js'
import { createCacheKey } from './create-cache-key.js'

/**
 * The cached equivalent of an async function.
 *
 * If the original function accepts a `Cache.ExecutionContext` as its final
 * argument, it is omitted from the public API.
 *
 * @example
 * ```ts
 * async function fetchUser(id: string, ctx?: Cache.ExecutionContext) {
 *   // ...
 * }
 *
 * const getUser: Cached<typeof fetchUser> = cached(fetchUser, {
 *   key: 'user',
 * })
 *
 * await getUser('123')
 * getUser.invalidate('123')
 * getUser.abort('123')
 * ```
 */
export type Cached<T extends (...args: any[]) => Promise<any>> = {
	(...args: ArgsWithoutExecutionContext<T>): Promise<Awaited<ReturnType<T>>>

	/**
	 * The prefix used when generating cache keys for this function.
	 */
	readonly prefix: string

	/**
	 * Computes the cache key for the given arguments.
	 */
	key(...args: ArgsWithoutExecutionContext<T>): string

	/**
	 * Drops the entry and notifies subscribers, but leaves any in-flight request
	 * running. Use this when a suspended consumer should still resolve normally.
	 *
	 * @see Cache.invalidate
	 */
	invalidate(...args: ArgsWithoutExecutionContext<T>): void

	/**
	 * Cancels the request and removes the entry without notifying subscribers, so
	 * nothing re-renders or refetches.
	 *
	 * @returns `true` if a request was aborted; otherwise `false`.
	 * @see Cache.abort
	 */
	abort(...args: ArgsWithoutExecutionContext<T>): boolean

	/**
	 * Cancels the request, drops the entry, and notifies subscribers so they
	 * re-read. This is `abort` plus `invalidate` in one call.
	 *
	 * @see Cache.invalidate
	 */
	refresh(...args: ArgsWithoutExecutionContext<T>): void

	/**
	 * Returns the cache entry for the given arguments without promoting it to
	 * the most recently used position.
	 *
	 * @see Cache.peek
	 */
	peek(...args: ArgsWithoutExecutionContext<T>): Cache.EntryInfo | undefined
}

// remove `Cache.ExecutionContext` from arg list if it exists
type ArgsWithoutExecutionContext<T extends (...args: any[]) => any> =
	Parameters<T> extends [...infer Args, Cache.ExecutionContext?] ? Args : Parameters<T>

/**
 * Options accepted by `cached(fn, opts)`.
 */
export type CachedOptions = Cache.EntryOptions & {
	key: string
	/**
	 * Replaces `createCacheKey` for this function. Receives the same arguments as
	 * the cached function and returns the fragment after the key prefix. Use it
	 * when arguments are large, or not serialisable by `createCacheKey`.
	 */
	keySerialiser?: (...args: any[]) => string
}

export function createCached(cache: Cache) {
	// track prefix ownership so two different functions cannot silently share
	// cache entries, which would return one function's data from the other
	const owners = new Map<string, unknown>()
	const warned = new Set<string>()

	return <T extends (...args: any[]) => Promise<any>>(
		fn: T,
		a: string | CachedOptions,
	) => {
		type TArgs = ArgsWithoutExecutionContext<T>
		type TValue = Awaited<ReturnType<T>>

		const {
			key: userKey,
			keySerialiser,
			...opts
		} = typeof a === 'string' ? { key: a } : a

		// when a serialiser is supplied, `createCacheKey` is never called
		const serialise = keySerialiser ?? createCacheKey

		const prefix = `${userKey}:`
		const owner = owners.get(prefix)

		if (owner !== undefined && owner !== fn && !warned.has(prefix)) {
			warned.add(prefix)
			devWarn(
				`[react-use-cache] cached() prefix "${userKey}" is used by more than one function. ` +
					'They will share cache entries; give each function a distinct key.',
			)
		} else if (owner === undefined) {
			owners.set(prefix, fn)
		}

		function key(...args: TArgs) {
			return `${prefix}${serialise(...args)}`
		}

		const cached: Cached<T> = Object.assign(
			(...args: TArgs) => cache.read<TValue>(key(...args), ctx => fn(...args, ctx), opts),
			{
				prefix,
				key,
				invalidate(...args: TArgs) {
					cache.invalidate(key(...args))
				},
				abort(...args: TArgs) {
					return cache.abort(key(...args))
				},
				refresh(...args: TArgs) {
					cache.invalidate(key(...args), { abort: true })
				},
				peek(...args: TArgs) {
					return cache.peek(key(...args))
				},
			},
		)

		return cached
	}
}

export const CacheContext = createContext<{
	cached: ReturnType<typeof createCached>
	cache: Cache
} | null>(null)

export function CacheProvider({
	children,
	defaults,
	cache: provided,
}: {
	children: React.ReactNode
	defaults?: Partial<Cache.Defaults>
	/**
	 * Use an existing cache instance instead of creating one. Read once: a new
	 * instance passed later is ignored. `defaults` is ignored when set.
	 */
	cache?: Cache
}) {
	const [cache] = useState(() => provided ?? new Cache(defaults))
	const [cached] = useState(() => createCached(cache))

	// a new `{ cached, cache }` object on every provider render would re-render
	// every consumer
	const value = useMemo(() => ({ cached, cache }), [cached, cache])

	return <CacheContext value={value}>{children}</CacheContext>
}
