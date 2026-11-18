# react-use-cache

A slight upgrade on a simple `Map` cache for `use(Promise)` in React 19.

## Packages

| Package | Description |
| --- | --- |
| [`@jk2908/react-use-cache`](./packages/react-use-cache) | The cache: two hooks, one class, a `Map` of promises |
| [`vite`](./examples/vite) | Example app: dedupe, abort, retries against dummyjson.com |

See each package's README for install, usage, and configuration.

## Releasing

1. Bump `version` in `package.json` and `packages/react-use-cache/package.json`.
2. Add a `## x.y.z` section to `packages/react-use-cache/CHANGELOG.md`.
3. Commit as `release: vx.y.z`.
4. Tag and push:

   ```sh
   git tag vx.y.z
   git push origin main --tags
   ```

5. Publish from the package:

   ```sh
   cd packages/react-use-cache
   npm publish --dry-run
   npm publish
   ```

## License

MIT