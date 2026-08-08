import { expect, test } from "bun:test"
import {
  SparkCost,
  pickRate,
  perMillion,
  DEFAULT_WEEKDAY,
  DEFAULT_WEEKEND,
} from "../src/index.ts"

const tables = { weekday: DEFAULT_WEEKDAY, weekend: DEFAULT_WEEKEND }

test("perMillion: formula and guards", () => {
  // 30W, 35.7¢, 20 tok/s → $0.14875 /1M
  expect(perMillion(30, 0.357, 20)).toBeCloseTo(0.14875, 6)
  expect(perMillion(30, 0.357, 70)).toBeCloseTo(0.0425, 6)
  expect(perMillion(30, 0.357, 0)).toBe(0) // div-by-zero guard
})

test("pickRate: flat overrides schedule", () => {
  const r = pickRate(new Date(), { ...tables, flat: 0.2 })
  expect(r).toEqual({ price: 0.2, label: "flat" })
})

test("pickRate: SDG&E weekday brackets", () => {
  const at = (h: number) => // Mon 2026-08-10
    pickRate(new Date(2026, 7, 10, h, 30), tables).label
  expect(at(2)).toBe("super-off-peak")
  expect(at(8)).toBe("off-peak")
  expect(at(12)).toBe("super-off-peak")
  expect(at(17)).toBe("on-peak")
  expect(at(22)).toBe("off-peak")
})

test("pickRate: full 24h coverage, no gaps (weekday+weekend)", () => {
  for (const [tag, d] of [["weekday", 10], ["weekend", 8]] as const)
    for (let h = 0; h < 24; h++) {
      const r = pickRate(new Date(2026, 7, d, h, 0), tables)
      expect(r.label, `${tag} h=${h}`).not.toBe("")
    }
})

test("pickRate: wrapping range [22,6] matches across midnight", () => {
  const t = {
    weekday: [
      { price: 0.1, label: "night", hours: [[22, 6]] as [number, number][] },
      { price: 0.3, label: "day", hours: [[6, 22]] as [number, number][] },
    ],
    weekend: DEFAULT_WEEKEND,
  }
  const lab = (h: number) => pickRate(new Date(2026, 7, 10, h, 0), t).label
  expect([lab(23), lab(0), lab(5)]).toEqual(["night", "night", "night"])
  expect([lab(6), lab(21)]).toEqual(["day", "day"])
})

test("config hook injects cost with cache_read=0", async () => {
  const toasts: string[] = []
  const client = {
    tui: { showToast: async (a: any) => toasts.push(a.body.message) },
  }
  const hooks = await SparkCost({ client } as any, {
    provider: "p",
    model: "m",
    flat: 0.357,
    watts: 30,
    outputTps: 20,
    prefillTps: 70,
    toast: false,
  })
  const config: any = { provider: { p: { models: { m: {} } } } }
  await hooks.config!(config)
  const cost = config.provider.p.models.m.cost
  expect(cost.output).toBeCloseTo(0.14875, 6)
  expect(cost.input).toBeCloseTo(0.0425, 6)
  expect(cost.cache_read).toBe(0)
})

test("config hook: bad throughput falls back to default (not free)", async () => {
  const hooks = await SparkCost({ client: {} } as any, {
    provider: "p",
    model: "m",
    flat: 0.357,
    outputTps: 0, // invalid → default 20
    toast: false,
  })
  const config: any = { provider: { p: { models: { m: {} } } } }
  await hooks.config!(config)
  expect(config.provider.p.models.m.cost.output).toBeGreaterThan(0)
})

test("config hook: merge preserves existing cost subfields", async () => {
  const hooks = await SparkCost({ client: {} } as any, {
    provider: "p",
    model: "m",
    flat: 0.2,
    toast: false,
  })
  const config: any = {
    provider: { p: { models: { m: { cost: { context_over_200k: { input: 9 } } } } } },
  }
  await hooks.config!(config)
  expect(config.provider.p.models.m.cost.context_over_200k).toEqual({ input: 9 })
})
