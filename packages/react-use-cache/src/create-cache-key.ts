import { stringify } from 'devalue'

/**
 * Create a cache key from the given arguments. Every argument is serialised, so
 * keys are deterministic and unambiguous: `1`, `'1'`, `1n`, `0` and `-0` all
 * produce distinct fragments; `devalue` escapes control characters, so a string
 * containing `\u0000` can never alias a multi-argument key.
 *
 * Values that can't be serialised throw. That includes functions, symbols, and
 * non-POJO objects such as class instances, `Error`, and DOM nodes. That's
 * deliberate: a value with no stable serialisation can't be keyed on reliably,
 * and failing loudly is better than silently conflating distinct values.
 * Supported built-ins include `Date`, `Map`, `Set`, `RegExp`, `URL`, and
 * `URLSearchParams`.
 *
 * Object key order is part of the key. `{ a: 1, b: 2 }` and `{ b: 2, a: 1 }`
 * serialise differently and produce different cache entries, so pass a stable
 * shape or a primitive identifier instead of an arbitrary object.
 *
 * @param args - The arguments to key on.
 * @returns A deterministic string key.
 */
export function createCacheKey(...args: unknown[]): string {
	return args.map(a => stringify(a)).join('\u0000')
}
