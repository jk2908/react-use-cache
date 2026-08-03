import { describe, expect, test } from 'vitest'

import { createCacheKey } from '../src/create-cache-key.js'

describe('createCacheKey', () => {
	test('returns the string form for a single primitive', () => {
		expect(createCacheKey('42')).toBe('42')
		expect(createCacheKey(0)).toBe('0')
		expect(createCacheKey(null)).toBe('null')
		expect(createCacheKey(true)).toBe('true')
	})

	test('returns a non-empty string for a single object', () => {
		expect(typeof createCacheKey({ id: 1 })).toBe('string')
		expect(createCacheKey({ id: 1 }).length).toBeGreaterThan(0)
	})

	test('joins multiple args with the unit separator', () => {
		const key = createCacheKey({ a: 1 }, { b: 2 })

		expect(key).toContain('\u0000')
	})

	test('is stable for structurally equal objects', () => {
		expect(createCacheKey({ x: 1 })).toBe(createCacheKey({ x: 1 }))
		expect(createCacheKey([1, 2, 3])).toBe(createCacheKey([1, 2, 3]))
	})
})
