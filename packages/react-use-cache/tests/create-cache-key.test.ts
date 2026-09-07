import { describe, expect, test } from 'vitest'

import { createCacheKey } from '../src/create-cache-key.js'

const keyOf = (value: unknown) => createCacheKey(value)

describe('createCacheKey', () => {
	test('produces a distinct key per primitive type', () => {
		expect(keyOf('42')).not.toBe(keyOf(42))
		expect(keyOf(1)).not.toBe(keyOf(1n))
		expect(keyOf(0)).not.toBe(keyOf(-0))
		expect(keyOf(1)).not.toBe(keyOf('1'))
		expect(keyOf(null)).not.toBe(keyOf(undefined))
		expect(keyOf('0')).not.toBe(keyOf(0))
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

	test('a string containing the separator cannot alias multiple args', () => {
		expect(createCacheKey('a\u0000b')).not.toBe(createCacheKey('a', 'b'))
	})

	test('is readable for single strings', () => {
		expect(createCacheKey('1')).toBe('["1"]')
	})

	test('throws for values that cannot be serialised', () => {
		expect(() => createCacheKey(() => {})).toThrow()
		expect(() => createCacheKey(Symbol('user'))).toThrow()
	})
})