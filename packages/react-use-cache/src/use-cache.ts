import { use } from 'react'

import { CacheContext } from './context.js'

/**
 * This hook returns the current cache instance from the context.
 * It must be used within a `CacheProvider`.
 *
 * @returns The current cache instance and the `cached` function for creating cached async functions.
 * @throws If the hook is used outside of a `CacheProvider`.
 */
export function useCache() {
	const context = use(CacheContext)
	if (!context) throw new Error('useCache must be used inside CacheProvider')

	return context
}
