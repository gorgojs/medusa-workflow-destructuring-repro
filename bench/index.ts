/**
 * Six small workflows in three pairs. The two workflows of a pair do the same thing, the first
 * written the usual way, the second with a transform on the workflow value itself.
 *
 *   yarn bench
 */
import {
  createStep,
  createWorkflow,
  StepResponse,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { createMedusaContainer } from "@medusajs/framework/utils"
import { collectGarbage, environment, formatNumber, median } from "./utils"

type Product = {
  external_id: string
  title: string
  description: string
  images: string[]
  options: { title: string; values: string[] }[]
  variants: {
    sku: string
    title: string
    options: Record<string, string>
    prices: { amount: number; currency_code: string }[]
  }[]
  attributes: { name: string; value: string }[]
}

type LoadProductsInput = {
  count: number
}

const SIZES = ["S", "M", "L", "XL"]
const DESCRIPTION =
  "Soft cotton t-shirt with a classic fit. Machine washable, keeps its shape after many washes. ".repeat(2)

/** Products with four variants (SKUs) and two prices each, the same on every call. */
function generateProducts(count: number): Product[] {
  return Array.from({ length: count }, (_, index) => ({
    external_id: `ext_${String(index).padStart(6, "0")}`,
    title: `Product ${index}`,
    description: DESCRIPTION,
    images: [0, 1, 2].map((n) => `https://cdn.example.com/products/${index}/${n}.jpg`),
    options: [{ title: "Size", values: SIZES }],
    variants: SIZES.map((size) => ({
      sku: `SKU-${index}-${size}`,
      title: `Product ${index} / ${size}`,
      options: { Size: size },
      prices: [
        { amount: 1000 + index, currency_code: "usd" },
        { amount: 900 + index, currency_code: "eur" },
      ],
    })),
    attributes: Array.from({ length: 8 }, (_, n) => ({
      name: `Attribute ${n}`,
      value: `Value ${(index + n) % 13}`,
    })),
  }))
}

const productsByCount = new Map<number, Product[]>()

/**
 * Returns `count` products as `{ data, metadata }`, the same shape as `useQueryGraphStep`.
 * The products are generated before measuring, so a measured run doesn't pay for building them.
 */
const loadProductsStep = createStep("load-products", async (input: LoadProductsInput) => {
  if (!productsByCount.has(input.count)) {
    productsByCount.set(input.count, generateProducts(input.count))
  }
  const data = productsByCount.get(input.count)!

  return new StepResponse({ data, metadata: { count: data.length } })
})

// The other steps only count what they get, so only passing values between steps is measured.
const countProductsStep = createStep("count-products", async (products: Product[]) => {
  return new StepResponse(products.length)
})

const saveProductsStep = createStep("save-products", async (input: { products: Product[] }) => {
  return new StepResponse(input.products.length)
})

function splitInHalves(products: Product[]) {
  const middle = Math.floor(products.length / 2)

  return { first: products.slice(0, middle), second: products.slice(middle) }
}

function benchWorkflow(name: string, compose: (input: LoadProductsInput) => void) {
  return createWorkflow(name, function (input: LoadProductsInput) {
    compose(input)

    return new WorkflowResponse(true)
  })
}

type BenchWorkflow = ReturnType<typeof benchWorkflow>

type Case = [name: string, workflow: BenchWorkflow]

// Each group does one thing two ways: the usual way first, then with a transform.
const groups: { action: string; usual: Case; withTransform: Case }[] = [
  {
    action: "Read `data` of a step result",
    usual: [
      "const { data: products } = loadProductsStep(input)",
      benchWorkflow("read-step-result-destructured", (input) => {
        const { data: products } = loadProductsStep(input)
        countProductsStep(products)
      }),
    ],
    withTransform: [
      "transform(loadProductsStep(input), (result) => result.data)",
      benchWorkflow("read-step-result-with-transform", (input) => {
        const products = transform(loadProductsStep(input), (result) => result.data)
        countProductsStep(products)
      }),
    ],
  },
  {
    action: "Read two fields of a transform result",
    usual: [
      "const { first, second } = transform(products, splitInHalves)",
      benchWorkflow("split-transform-result-destructured", (input) => {
        const products = transform(loadProductsStep(input), (result) => result.data)
        const { first, second } = transform(products, splitInHalves)
        countProductsStep(first).config({ name: "count-first-half" })
        countProductsStep(second).config({ name: "count-second-half" })
      }),
    ],
    withTransform: [
      "transform(halves, (data) => data.first), same for second",
      benchWorkflow("split-transform-result-with-transform", (input) => {
        const products = transform(loadProductsStep(input), (result) => result.data)
        const halves = transform(products, splitInHalves)
        countProductsStep(transform(halves, (data) => data.first)).config({ name: "count-first-half" })
        countProductsStep(transform(halves, (data) => data.second)).config({ name: "count-second-half" })
      }),
    ],
  },
  {
    action: "Pass products to a step that takes `{ products }`",
    usual: [
      "saveProductsStep({ products })",
      benchWorkflow("pass-step-input-as-object-literal", (input) => {
        const products = transform(loadProductsStep(input), (result) => result.data)
        saveProductsStep({ products })
      }),
    ],
    withTransform: [
      "saveProductsStep(transform(products, (data) => ({ products: data })))",
      benchWorkflow("pass-step-input-with-transform", (input) => {
        const products = transform(loadProductsStep(input), (result) => result.data)
        saveProductsStep(transform(products, (data) => ({ products: data })))
      }),
    ],
  },
]

// Fewer runs for larger batches: one run with 10,000 products takes a third of a second.
const sizes = [
  { count: 100, warmUp: 50, runs: 300 },
  { count: 1000, warmUp: 50, runs: 60 },
  { count: 10000, warmUp: 3, runs: 10 },
]

const container = createMedusaContainer()

async function medianRunTime(workflow: BenchWorkflow, count: number, warmUp: number, runs: number) {
  collectGarbage()
  for (let i = 0; i < warmUp; i++) {
    await workflow(container).run({ input: { count } })
  }

  const times: number[] = []
  for (let i = 0; i < runs; i++) {
    const start = performance.now()
    await workflow(container).run({ input: { count } })
    times.push(performance.now() - start)
  }

  return median(times)
}

async function main() {
  // Generate every batch up front, so all cases run with the same data in memory.
  for (const { count } of sizes) {
    productsByCount.set(count, generateProducts(count))
  }

  // Warm up every case on every size, so the first measured case doesn't pay for compiling the
  // SDK code or for the heap growing to fit the largest batch.
  for (const [, workflow] of groups.flatMap((group) => [group.usual, group.withTransform])) {
    for (const { count, warmUp } of sizes) {
      for (let i = 0; i < warmUp; i++) {
        await workflow(container).run({ input: { count } })
      }
    }
  }

  console.log(environment())
  console.log(
    `Median time of one workflow run, ${sizes.map(({ count, runs }) => `${runs} runs for ${formatNumber(count)} products`).join(", ")}\n`
  )
  console.log(`| Case | ${sizes.map(({ count }) => `${formatNumber(count)} products, ms`).join(" | ")} |`)
  console.log(`| --- | ${sizes.map(() => "---:").join(" | ")} |`)
  for (const { action, usual, withTransform } of groups) {
    const usualTimes: number[] = []
    const withTransformTimes: number[] = []
    for (const { count, warmUp, runs } of sizes) {
      usualTimes.push(await medianRunTime(usual[1], count, warmUp, runs))
      withTransformTimes.push(await medianRunTime(withTransform[1], count, warmUp, runs))
    }

    const withTransformCells = withTransformTimes.map(
      (time, i) => `${formatNumber(time, 2)} (${formatNumber(usualTimes[i] / time, 1)}x faster)`
    )
    console.log(`| **${action}** | ${sizes.map(() => "").join(" | ")} |`)
    console.log(`| \`${usual[0]}\` | ${usualTimes.map((time) => formatNumber(time, 2)).join(" | ")} |`)
    console.log(`| \`${withTransform[0]}\` | ${withTransformCells.join(" | ")} |`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
