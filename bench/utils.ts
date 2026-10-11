import { readFileSync } from "node:fs"
import { arch, cpus, platform } from "node:os"
import { join } from "node:path"

/** Medusa, Node and CPU, printed above the results so a copied table explains itself. */
export function environment(): string {
  const framework = JSON.parse(
    readFileSync(join(process.cwd(), "node_modules/@medusajs/framework/package.json"), "utf8")
  )
  return `Medusa ${framework.version}, Node ${process.version}, ${cpus()[0].model.trim()} (${platform()} ${arch()})`
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

/** Collects garbage between measurements when Node runs with --expose-gc. */
export function collectGarbage() {
  global.gc?.()
}

export function formatNumber(value: number, digits = 0): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })
}
