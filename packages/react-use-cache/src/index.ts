import { Cache, isCacheExecutionContext } from './cache.js'

export type CacheExecutionContext = Cache.ExecutionContext
export { Cache, isCacheExecutionContext }

export { CacheProvider, type Cached } from './context.js'
export { createCacheKey } from './create-cache-key.js'
export { useCache } from './use-cache.js'
export { useVersion } from './use-version.js'
