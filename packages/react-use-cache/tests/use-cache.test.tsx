import { act, render, screen } from '@testing-library/react'
import { Suspense, use } from 'react'
import { ErrorBoundary } from 'react-error-boundary'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { Cache, CacheProvider, useCache, useVersion } from '../src/index.js'

// a controllable async function; tests swap `state` to drive values/errors
let state: (id: string) => unknown = id => ({ id, name: 'Ada' })

async function getUser(id: string) {
	const value = state(id)
	if (value instanceof Error) throw value

	return value as { id: string; name: string }
}

beforeEach(() => {
	state = id => ({ id, name: 'Ada' })
})

describe('Rendering', () => {
	test('suspends, then renders the resolved value', async () => {
		await act(async () => {
			render(
				<CacheProvider>
					<Suspense fallback={<div>Loading...</div>}>
						<Reader id="1" />
					</Suspense>
				</CacheProvider>,
			)
		})

		expect(screen.getByText('Ada')).toBeInTheDocument()
	})

	test('reuses the in-flight promise across siblings (one call)', async () => {
		const fn = vi.fn(getUser)

		await act(async () => {
			render(
				<CacheProvider>
					<Suspense fallback={<div>Loading...</div>}>
						<Reader id="1" fn={fn} />
						<Reader id="1" fn={fn} />
					</Suspense>
				</CacheProvider>,
			)
		})

		expect(screen.getAllByText('Ada')).toHaveLength(2)
		expect(fn).toHaveBeenCalledTimes(1)
	})

	test('invalidate + useVersion re-fetches with the new payload', async () => {
		const ref: { cache?: Cache } = {}

		await act(async () => {
			render(
				<CacheProvider>
					<Probe ref={ref} />
					<Suspense fallback={<div>Loading...</div>}>
						<VersionedReader id="1" />
					</Suspense>
				</CacheProvider>,
			)
		})
		expect(screen.getByText('Ada')).toBeInTheDocument()

		state = () => ({ id: '1', name: 'Grace' })

		await act(async () => {
			ref.cache!.invalidate('user:["1"]')
		})

		expect(screen.getByText('Grace')).toBeInTheDocument()
	})

	test('surfaces errors to the boundary', async () => {
		state = () => new Error('boom')

		await act(async () => {
			render(
				<ErrorBoundary fallback={<div>boom</div>}>
					<CacheProvider>
						<Suspense fallback={<div>Loading...</div>}>
							<Reader id="1" retries={0} />
						</Suspense>
					</CacheProvider>
				</ErrorBoundary>,
			)
		})

		expect(screen.getByText('boom')).toBeInTheDocument()
	})

	test('useCache throws outside a provider', async () => {
		await act(async () => {
			render(
				<ErrorBoundary
					fallbackRender={({ error }) => <div>caught:{(error as Error).message}</div>}>
					<Throwing />
				</ErrorBoundary>,
			)
		})

		expect(screen.getByText(/caught:/).textContent).toMatch(/CacheProvider/)
	})

	test('accepts the shorthand string-key overload', async () => {
		await act(async () => {
			render(
				<CacheProvider>
					<Suspense fallback={<div>Loading...</div>}>
						<Reader id="1" shorthand />
					</Suspense>
				</CacheProvider>,
			)
		})

		expect(screen.getByText('Ada')).toBeInTheDocument()
	})

	test('cached exposes refresh', async () => {
		const ref: { cache?: Cache; get?: CapturedCached } = {}

		await act(async () => {
			render(
				<CacheProvider>
					<Suspense fallback={<div>Loading...</div>}>
						<CapturingReader id="1" ref={ref} />
					</Suspense>
				</CacheProvider>,
			)
		})
		expect(screen.getByText('Ada')).toBeInTheDocument()

		const key = ref.get!.key('1')
		expect(ref.cache!.has(key)).toBe(true)

		// refresh drops the entry for a clean re-read
		ref.get!.refresh('1')
		expect(ref.cache!.has(key)).toBe(false)

		// re-populate through the wrapper
		void ref.get!('1')
		await act(async () => {})
		expect(ref.cache!.has(key)).toBe(true)
	})
})

function Reader({
	id,
	retries,
	fn = getUser,
	shorthand,
}: {
	id: string
	retries?: number
	fn?: typeof getUser
	shorthand?: boolean
}) {
	const { cached } = useCache()
	const get = shorthand ? cached(fn, 'user') : cached(fn, { key: 'user', retries })
	const user = use(get(id))

	return <div>{user.name}</div>
}

function VersionedReader({ id, retries }: { id: string; retries?: number }) {
	useVersion('user:["1"]')
	const { cached } = useCache()
	const get = cached(getUser, { key: 'user', retries })
	const user = use(get(id))

	return <div>{user.name}</div>
}

function Probe({ ref }: { ref: { cache?: Cache } }) {
	ref.cache = useCache().cache
	return null
}

type CapturedCached = {
	(id: string): Promise<{ name: string }>
	key: (id: string) => string
	refresh: (id: string) => void
}

function CapturingReader({
	id,
	ref,
}: {
	id: string
	ref: { cache?: Cache; get?: CapturedCached }
}) {
	const { cache, cached } = useCache()
	const get = cached(getUser, 'user') as CapturedCached
	const { name } = use(get(id))

	ref.cache = cache
	ref.get = get

	return <div>{name}</div>
}

function Throwing() {
	useCache()
	return null
}
