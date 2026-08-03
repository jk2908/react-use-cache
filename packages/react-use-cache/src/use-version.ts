import { useSyncExternalStore } from 'react'

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

	return useSyncExternalStore(
		cb => cache.subscribe(key, cb),
		() => cache.version(key),
		() => cache.version(key),
	)
}
