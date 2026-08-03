import { Suspense, use } from 'react'
import { ErrorBoundary } from 'react-error-boundary'
import {
	Cached,
	CacheProvider,
	useCache,
	useVersion,
	type ExecutionContext,
} from 'react-use-cache'

async function fetchUser(id: string, { signal }: ExecutionContext) {
	const res = await fetch(`https://dummyjson.com/users/${id}`, {
		signal,
	})

	if (!res.ok) {
		throw new Error(`User ${id} failed (${res.status})`)
	}

	const user = await res.json()

	return {
		...user,
		fetchedAt: Date.now(),
	}
}

async function fetchSlowUser(id: string, { signal }: ExecutionContext) {
	const res = await fetch(`https://dummyjson.com/users/${id}?delay=3000`, {
		signal,
	})

	return res.json()
}

async function fetchBrokenUser(_id: string, { signal }: ExecutionContext) {
	const res = await fetch(`https://dummyjson.com/users/99999`, {
		signal,
	})

	if (!res.ok) {
		throw new Error(`User does not exist`)
	}

	return res.json()
}

export default function App() {
	return (
		<CacheProvider>
			<Demo />
		</CacheProvider>
	)
}

function Demo() {
	const { cached } = useCache()

	const getUser = cached(fetchUser, {
		key: 'user',
	})

	const getSlowUser = cached(fetchSlowUser, {
		key: 'slow-user',
	})

	const getBrokenUser = cached(fetchBrokenUser, {
		key: 'broken-user',
		retries: 3,
	})

	const getInlineUser = cached(async (id: string, { signal }: ExecutionContext) => {
		const res = await fetch(`https://dummyjson.com/users/${id}`, {
			signal,
		})

		if (!res.ok) {
			throw new Error(`User ${id} failed (${res.status})`)
		}

		const user = await res.json()

		return {
			...user,
			fetchedAt: Date.now(),
		}
	}, 'inline-user')

	return (
		<>
			<h1>Cache demo</h1>

			<h2>Request de-dupe</h2>

			<UserRow id="1" getUser={getUser} />
			<UserRow id="1" getUser={getUser} />

			<h2>AbortController</h2>

			<SlowUserRow id="2" getUser={getSlowUser} />

			<h2>Retries</h2>

			<UserRow id="999" getUser={getBrokenUser} />

			<h2>Inline cached function</h2>

			<UserRow id="3" getUser={getInlineUser} />
		</>
	)
}

function UserRow({ id, getUser }: { id: string; getUser: Cached<typeof fetchUser> }) {
	const promise = getUser(id)
	const version = useVersion(getUser.key(id))

	return (
		<div>
			<ErrorBoundary
				resetKeys={[version]}
				fallbackRender={({ error }) => <div>{getErrorMessage(error)}</div>}>
				<Suspense fallback={<div>Loading {id}</div>}>
					<User promise={promise} />
				</Suspense>
			</ErrorBoundary>

			<button onClick={() => getUser.invalidate(id)}>Invalidate</button>
		</div>
	)
}

function SlowUserRow({
	id,
	getUser,
}: {
	id: string
	getUser: Cached<typeof fetchSlowUser>
}) {
	const promise = getUser(id)
	const version = useVersion(getUser.key(id))

	return (
		<div>
			<ErrorBoundary
				resetKeys={[version]}
				fallbackRender={({ error }) => <div>{getErrorMessage(error)}</div>}>
				<Suspense fallback={<div>Loading slow user...</div>}>
					<User promise={promise} />
				</Suspense>
			</ErrorBoundary>

			<button onClick={() => getUser.abort(id)}>Abort</button>
			<button onClick={() => getUser.invalidate(id)}>Invalidate</button>
		</div>
	)
}

type UserData = {
	name: string
	email: string
}

function User({ promise }: { promise: Promise<UserData> }) {
	const user = use(promise)

	return (
		<div>
			{user.name} ({user.email})
		</div>
	)
}

function getErrorMessage(error: unknown) {
	if (error instanceof DOMException && error.name === 'AbortError') {
		return 'Aborted'
	}

	if (typeof error === 'object' && error !== null && 'message' in error) {
		return String(error.message)
	}

	return JSON.stringify(error)
}
