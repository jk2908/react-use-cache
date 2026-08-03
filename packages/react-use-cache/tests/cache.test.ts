import { describe, expect, test, vi } from 'vitest'

import { Cache } from '../src/cache.js'

describe('Cache', () => {
	test('reuses rejected promises until they are invalidated', async () => {
		const cache = new Cache()

		let fail = true
		let calls = 0

		const readUser = () =>
			cache.read(
				'user:4',
				async () => {
					calls++
					if (fail) throw new Error('User not found')

					return { id: '4' }
				},
				{ retries: 0 },
			)

		const first = readUser()
		const second = readUser()

		expect(second).toBe(first)
		await expect(first).rejects.toThrow('User not found')

		const third = readUser()

		expect(third).toBe(first)
		expect(calls).toBe(1)

		fail = false
		cache.invalidate('user:4')

		await expect(readUser()).resolves.toEqual({ id: '4' })
		expect(calls).toBe(2)
	})

	test('supports lifecycle helpers', async () => {
		const cache = new Cache({ maxSize: 4 })

		const a = Promise.resolve('a')
		const b = Promise.resolve('b')

		cache.read('user:1', () => a)
		cache.read('post:1', () => b)

		expect(cache.has('user:1')).toBe(true)
		await expect(cache.peek('user:1')?.p).resolves.toBe('a')

		cache.invalidate(k => k.startsWith('user'))

		expect(cache.has('user:1')).toBe(false)
		expect(cache.has('post:1')).toBe(true)

		expect(cache.clear()).toBe(1)
		expect(cache.size).toBe(0)

		await expect(b).resolves.toBe('b')
	})

	test('evicts the least-recently-used entry past maxSize', () => {
		const cache = new Cache({ maxSize: 2 })

		cache.read('a', () => Promise.resolve(1))
		cache.read('b', () => Promise.resolve(2))

		// re-read 'a' so it becomes most-recently-used, leaving 'b' as LRU
		cache.read('a', () => Promise.resolve(1))
		cache.read('c', () => Promise.resolve(3)) // evicts 'b'

		expect(cache.has('a')).toBe(true)
		expect(cache.has('b')).toBe(false)
		expect(cache.has('c')).toBe(true)
		expect(cache.size).toBe(2)
	})

	test('retries up to the budget then succeeds', async () => {
		const cache = new Cache({ retries: 3 })
		let attempts = 0

		const read = cache.read('flaky', async () => {
			attempts++
			if (attempts < 3) throw new Error('again')

			return 'ok'
		})

		await expect(read).resolves.toBe('ok')
		expect(attempts).toBe(3)
	})

	test('aborts an in-flight entry, rethrowing without consuming retries', async () => {
		const cache = new Cache({ retries: 3 })

		const read = cache.read('slow', ({ signal }) => {
			return new Promise((_resolve, reject) => {
				signal.addEventListener('abort', () => {
					reject(new DOMException('Aborted', 'AbortError'))
				})
			})
		})

		cache.abort('slow')

		await expect(read).rejects.toThrow('Aborted')
		// aborted entry is removed once settled; a fresh read starts clean
		expect(cache.has('slow')).toBe(false)
	})

	test('subscribe + version track invalidations', async () => {
		const cache = new Cache()

		const seen: number[] = []
		const unsub = cache.subscribe('user:1', () => seen.push(cache.version('user:1')))

		expect(cache.version('user:1')).toBe(0)
		expect(seen).toHaveLength(0)

		cache.read('user:1', () => Promise.resolve('a'))
		cache.invalidate('user:1')

		await new Promise(r => setTimeout(r, 0))
		expect(cache.version('user:1')).toBe(1)
		expect(seen).toEqual([1])

		unsub()
		// last listener gone -> slot is dropped, so version reports 0 again.
		// This keeps the subscription map bounded by mounted subscribers
		expect(cache.version('user:1')).toBe(0)
	})

	test('version is 0 for keys with no subscriber', () => {
		const cache = new Cache()

		cache.read('user:1', () => Promise.resolve('a'))
		// invalidating an unwatched key is a no-op on the version counter
		cache.invalidate('user:1')
		expect(cache.version('user:1')).toBe(0)
	})

	test('clear aborts and bumps every subscribed key', async () => {
		const cache = new Cache()

		const seen: string[] = []
		cache.subscribe('user:1', () => seen.push('user:1'))
		cache.subscribe('post:1', () => seen.push('post:1'))

		cache.read('user:1', () => Promise.resolve('a'))
		cache.read('post:1', () => Promise.resolve('b'))

		expect(cache.clear()).toBe(2)
		expect(seen.toSorted()).toEqual(['post:1', 'user:1'])
		expect(cache.size).toBe(0)
	})

	test('abort returns false for a missing key', () => {
		const cache = new Cache()
		expect(cache.abort('nope')).toBe(false)
	})

	test('delete returns false for a missing key', () => {
		const cache = new Cache()
		expect(cache.delete('nope')).toBe(false)
	})

	test('peek does not promote the entry to most-recently-used', () => {
		const cache = new Cache({ maxSize: 2 })

		cache.read('a', () => Promise.resolve(1))
		cache.read('b', () => Promise.resolve(2))

		// peek 'a' repeatedly — it should remain the LRU candidate
		expect(cache.peek('a')).toBeDefined()
		expect(cache.peek('a')).toBeDefined()

		cache.read('c', () => Promise.resolve(3)) // evicts LRU = 'a'

		expect(cache.has('a')).toBe(false)
		expect(cache.has('b')).toBe(true)
		expect(cache.has('c')).toBe(true)
	})

	test('per-call retries override the global budget', async () => {
		const cache = new Cache({ retries: 0 })
		let attempts = 0

		const read = cache.read(
			'flaky',
			async () => {
				attempts++
				if (attempts < 2) throw new Error('again')

				return 'ok'
			},
			{ retries: 3 },
		)

		await expect(read).resolves.toBe('ok')
		expect(attempts).toBe(2)
	})

	test('eviction aborts in-flight entries', async () => {
		const cache = new Cache({ maxSize: 1 })

		const read = cache.read('slow', ({ signal }) => {
			return new Promise((_resolve, reject) => {
				signal.addEventListener('abort', () => {
					reject(new DOMException('Aborted', 'AbortError'))
				})
			})
		})

		// pushing a second entry evicts the LRU one, aborting it
		cache.read('fast', () => Promise.resolve('fast'))

		await expect(read).rejects.toThrow('Aborted')
	})

	test('retries with exponential backoff between attempts', async () => {
		vi.useFakeTimers()
		try {
			const cache = new Cache({ retries: 3, backoff: 100 })
			let attempts = 0

			const read = cache.read('flaky', async () => {
				attempts++
				if (attempts < 3) throw new Error('again')

				return 'ok'
			})

			// 100ms after attempt 1 fails, 200ms after attempt 2 fails, then succeeds
			await vi.advanceTimersByTimeAsync(300)

			await expect(read).resolves.toBe('ok')
			expect(attempts).toBe(3)
		} finally {
			vi.useRealTimers()
		}
	})

	test('retries with fixed backoff hold the delay steady', async () => {
		vi.useFakeTimers()

		try {
			const cache = new Cache({ retries: 3, backoff: 100, backoffStrategy: 'fixed' })
			let attempts = 0

			const read = cache.read('flaky', async () => {
				attempts++
				if (attempts < 3) throw new Error('again')

				return 'ok'
			})

			// 100ms after attempt 1, then another 100ms before attempt 3 succeeds
			await vi.advanceTimersByTimeAsync(200)

			await expect(read).resolves.toBe('ok')
			expect(attempts).toBe(3)
		} finally {
			vi.useRealTimers()
		}
	})

	test('abort short-circuits a pending backoff delay', async () => {
		const cache = new Cache({ retries: 3, backoff: 1000 })
		let attempts = 0

		const read = cache.read('flaky', async () => {
			attempts++
			throw new Error('again')
		})

		// abort before the 1s backoff elapses — the wait resolves early and the
		// loop surfaces an AbortError instead of retrying again
		cache.abort('flaky')

		await expect(read).rejects.toThrow('Aborted')
		expect(attempts).toBe(1)
		expect(cache.has('flaky')).toBe(false)
	})

	test('invalidate predicate drops every matching entry', () => {
		const cache = new Cache()
		const seen: string[] = []

		cache.subscribe('user:1', () => seen.push('user:1'))
		cache.subscribe('user:2', () => seen.push('user:2'))
		cache.subscribe('post:1', () => seen.push('post:1'))

		cache.read('user:1', () => Promise.resolve('a'))
		cache.read('user:2', () => Promise.resolve('b'))
		cache.read('post:1', () => Promise.resolve('c'))

		// predicate is the canonical way to invalidate keys sharing a prefix
		cache.invalidate(key => key.startsWith('user:'))

		expect(cache.has('user:1')).toBe(false)
		expect(cache.has('user:2')).toBe(false)
		expect(cache.has('post:1')).toBe(true)

		// only the user:* subscribers were notified
		expect(seen.toSorted()).toEqual(['user:1', 'user:2'])
	})
})
