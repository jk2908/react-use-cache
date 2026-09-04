import { useCallback, useSyncExternalStore } from 'react'

import { useCache } from './use-cache.js'

/**
 * A hook that returns the current version of a cached entry. This hook subscribes
 * to the cache and will re-render the component whenever the version
 * of the specified key changes.
 *
 * @param key - The key of the cached entry to track.
 * @returns The current version number of the cached entry.
 */
export function useVersion(key: string) {
	const { cache } = useCache()

	const subscribe = useCallback(
		(cb: () => void) => cache.subscribe(key, cb),
		[cache, key],
	)
	const getSnapshot = useCallback(() => cache.version(key), [cache, key])

	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
