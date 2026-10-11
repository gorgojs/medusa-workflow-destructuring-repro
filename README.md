# medusa-workflow-destructuring-repro

In Medusa v2 workflows, reading a field of a step or transform result (`const { data } = step()`,
`const { a, b } = transform(...)`) or passing a workflow value inside an object literal
(`step({ products })`) deep-copies the whole value several times. The benchmark runs three pairs of
small workflows. Both workflows of a pair do the same thing, the first written the usual way, the
second with a `transform` on the workflow value itself. No database is needed.

## Install and run

Node 20.19+ or 22.12+, Yarn 4 through Corepack.

```bash
corepack enable
yarn install
yarn bench
```

## Results

AMD Ryzen 5 7430U, Node 24.21.0, Medusa 2.21.1. Median time of one workflow run, 300 runs for 100
products, 60 runs for 1,000 and 10 runs for 10,000, each product with four variants and two prices.

| Case | 100 products, ms | 1,000 products, ms | 10,000 products, ms |
| --- | ---: | ---: | ---: |
| **Read `data` of a step result** | | | |
| `const { data: products } = loadProductsStep(input)` | 1.55 | 18.21 | 177.77 |
| `transform(loadProductsStep(input), (result) => result.data)` | 0.57 (2.7x faster) | 4.19 (4.4x faster) | 55.53 (3.2x faster) |
| **Read two fields of a transform result** | | | |
| `const { first, second } = transform(products, splitInHalves)` | 3.33 | 40.15 | 464.37 |
| `transform(halves, (data) => data.first)`, same for `second` | 1.27 (2.6x faster) | 12.22 (3.3x faster) | 176.23 (2.6x faster) |
| **Pass products to a step that takes `{ products }`** | | | |
| `saveProductsStep({ products })` | 1.62 | 17.02 | 209.40 |
| `saveProductsStep(transform(products, (data) => ({ products: data })))` | 0.80 (2.0x faster) | 6.74 (2.5x faster) | 100.31 (2.1x faster) |

On Node 22.20 every case is slower, by up to 21% with 100 products and by 37–85% with 1,000, and
the usual way stays 2–3 times slower than the `transform`.
