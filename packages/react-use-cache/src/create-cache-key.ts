import { stringify } from 'devalue'

export function createCacheKey(...args: unknown[]): string {
	if (args.length === 1) {
		const a = args[0]

		if (a == null || (typeof a !== 'object' && typeof a !== 'function')) {
			return String(a)
		}
	}

	return args.map(a => stringify(a)).join('\u0000')
}
