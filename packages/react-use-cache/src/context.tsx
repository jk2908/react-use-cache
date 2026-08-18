import { createContext, useState } from 'react'

import { Cache } from './cache.js'
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
	 * Invalidates the cached result for the given arguments.
	 *
	 * @see Cache.invalidate
	 */
	invalidate(...args: ArgsWithoutExecutionContext<T>): void

	/**
	 * Aborts an in-flight request for the given arguments.
	 *
	 * @returns `true` if a request was aborted; otherwise `false`.
	 * @see Cache.abort
	 */
	abort(...args: ArgsWithoutExecutionContext<T>): boolean

	/**
	 * Returns the cache entry for the given arguments without promoting it to
	 * the most recently used position.
	 *
	 * @see Cache.peek
	 */
	peek(...args: ArgsWithoutExecutionContext<T>): Cache.Entry | undefined
}

// remove `Cache.ExecutionContext` from arg list if it exists
type ArgsWithoutExecutionContext<T extends (...args: any[]) => any> =
	Parameters<T> extends [...infer Args, Cache.ExecutionContext?] ? Args : Parameters<T>

export function createCached(cache: Cache) {
	return <T extends (...args: any[]) => Promise<any>>(
		fn: T,
		a: string | (Cache.EntryOptions & { key: string }),
	) => {
		type TArgs = ArgsWithoutExecutionContext<T>
		type TValue = Awaited<ReturnType<T>>

		const { key: userKey, ...opts } = typeof a === 'string' ? { key: a } : a

		const prefix = `${userKey}:`

		function key(...args: TArgs) {
			return `${prefix}${createCacheKey(...args)}`
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
	globalOpts,
}: {
	children: React.ReactNode
	globalOpts?: Cache.GlobalOptions
}) {
	const [cache] = useState(() => new Cache(globalOpts))
	const cached = createCached(cache)

	return <CacheContext value={{ cached, cache }}>{children}</CacheContext>
}
