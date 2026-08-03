/// <reference types="@types/bun" />

import fs from 'node:fs/promises'
import path from 'node:path'

const rootDir = import.meta.dir
const srcDir = path.join(rootDir, 'src')
const distDir = path.join(rootDir, 'dist')

await fs.rm(distDir, { recursive: true, force: true })

const entrypoints: string[] = []

for (const file of await fs.readdir(srcDir)) {
	if (file.endsWith('.ts') || file.endsWith('.tsx')) {
		entrypoints.push(path.join(srcDir, file))
	}
}

const result = await Bun.build({
	entrypoints,
	format: 'esm',
	outdir: distDir,
	packages: 'external',
	sourcemap: 'external',
	target: 'browser',
})

if (!result.success) {
	for (const log of result.logs) console.error(log)
	process.exit(1)
}
