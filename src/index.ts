import type { Plugin } from "@opencode-ai/plugin"

declare const process: { env: Record<string, string | undefined> }

// ─────────────────────────────────────────────────────────────────────────
// opencode-spark-cost
//
// Shows the *electricity* cost of running a local model (e.g. on an NVIDIA
// DGX Spark) in opencode's native cost badge. Local/offline models normally
// report $0 — this plugin fills that in with real energy cost.
//
//   $/1M tokens = watts * price_$perkWh / (3.6 * tokens_per_sec)
//
// Two throughputs are used because prefill (input) is much faster — and thus
// cheaper per token — than decode (output). Both are logged by sglang/vLLM.
//
// The rate is chosen from the wall clock at launch via a time-of-use (TOU)
// schedule. The `config` hook runs once per launch, so relaunch opencode to
// re-pick after you cross a rate boundary.
// ─────────────────────────────────────────────────────────────────────────

export type TouBracket = {
  /** $/kWh for this bracket. */
  price: number
  /** Hours [start,end) in 24h local time this bracket covers. Wraps at 24. */
  hours: [number, number][]
  /** Label shown in the launch toast. */
  label?: string
}

export type SparkCostOptions = {
  /** Provider id in your opencode config. Default: "ling-codellm". */
  provider?: string
  /** Model id under that provider. Default: "ling-3.0-flash". */
  model?: string
  /** Apply to every model of the provider instead of one. Default: false. */
  allModels?: boolean

  /** Marginal draw while generating (active − idle), watts. Default: 30. */
  watts?: number
  /** Decode throughput, output tokens/sec. Measure it. Default: 20. */
  outputTps?: number
  /** Prefill throughput, input tokens/sec. Measure it. Default: 70. */
  prefillTps?: number

  /**
   * Time-of-use schedule. Weekday and weekend brackets in $/kWh.
   * Any hour not covered falls back to `flat` (or the first bracket).
   * Default: SDG&E TOU-DR-1, Tier 1 (San Diego).
   */
  weekday?: TouBracket[]
  weekend?: TouBracket[]
  /** Flat $/kWh — use instead of a TOU schedule. Overrides weekday/weekend. */
  flat?: number

  /** Show a toast with the picked bracket at launch. Default: true. */
  toast?: boolean
}

// SDG&E TOU-DR-1, Tier 1 ($/kWh) as of 2026. Override for your utility.
const DEFAULT_WEEKDAY: TouBracket[] = [
  { price: 0.267, label: "super-off-peak", hours: [[0, 6], [10, 14]] },
  { price: 0.357, label: "off-peak", hours: [[6, 10], [14, 16], [21, 24]] },
  { price: 0.584, label: "on-peak", hours: [[16, 21]] },
]
const DEFAULT_WEEKEND: TouBracket[] = [
  { price: 0.267, label: "super-off-peak", hours: [[0, 14]] },
  { price: 0.357, label: "off-peak", hours: [[14, 16], [21, 24]] },
  { price: 0.584, label: "on-peak", hours: [[16, 21]] },
]

const num = (v: unknown, d: number) => {
  const n = typeof v === "string" ? parseFloat(v) : (v as number)
  return Number.isFinite(n) ? (n as number) : d
}

function pickRate(
  now: Date,
  o: Required<Pick<SparkCostOptions, "weekday" | "weekend">> & { flat?: number },
): { price: number; label: string } {
  if (typeof o.flat === "number") return { price: o.flat, label: "flat" }
  const weekend = now.getDay() === 0 || now.getDay() === 6
  const table = weekend ? o.weekend : o.weekday
  const h = now.getHours()
  for (const b of table)
    for (const [start, end] of b.hours)
      if (h >= start && h < end) return { price: b.price, label: b.label ?? "" }
  return { price: table[0]?.price ?? 0, label: table[0]?.label ?? "" }
}

/** $ per 1M tokens. */
const perMillion = (watts: number, price: number, tps: number) =>
  tps > 0 ? (watts * price) / (3.6 * tps) : 0

export const SparkCost: Plugin = async ({ client }, options) => {
  const o = (options ?? {}) as SparkCostOptions
  const env = process.env

  const provider = o.provider ?? env.SPARK_PROVIDER ?? "ling-codellm"
  const model = o.model ?? env.SPARK_MODEL ?? "ling-3.0-flash"
  const allModels = o.allModels ?? env.SPARK_ALL_MODELS === "true"
  const watts = num(o.watts ?? env.SPARK_WATTS, 30)
  const outputTps = num(o.outputTps ?? env.SPARK_OUTPUT_TPS, 20)
  const prefillTps = num(o.prefillTps ?? env.SPARK_PREFILL_TPS, 70)
  const flat = o.flat ?? (env.SPARK_FLAT_RATE ? num(env.SPARK_FLAT_RATE, NaN) : undefined)
  const weekday = o.weekday ?? DEFAULT_WEEKDAY
  const weekend = o.weekend ?? DEFAULT_WEEKEND
  const showToast = o.toast ?? env.SPARK_TOAST !== "false"

  // Summary for the toast, filled by the config hook.
  let summary: string | null = null
  let toasted = false

  return {
    // Synchronous cost injection. Must NOT block or await anything slow —
    // this runs during bootstrap before the TUI/server is ready.
    config: async (config: any) => {
      const models = config?.provider?.[provider]?.models
      if (!models) return

      const { price, label } = pickRate(new Date(), {
        weekday,
        weekend,
        flat: Number.isFinite(flat as number) ? (flat as number) : undefined,
      })
      const cost = {
        input: perMillion(watts, price, prefillTps),
        output: perMillion(watts, price, outputTps),
      }

      const targets = allModels ? Object.keys(models) : [model]
      let applied = false
      for (const id of targets) {
        if (!models[id]) continue
        models[id].cost = { ...cost }
        applied = true
      }
      if (!applied) return

      summary = `${label || "rate"} @ ${(price * 100).toFixed(1)}¢/kWh → $${cost.output.toFixed(4)}/1M out, $${cost.input.toFixed(4)}/1M in`
    },

    // Toast once, on the first event — by now the TUI is attached, so this
    // is safe to await. Doing it in `config` deadlocks bootstrap.
    event: async () => {
      if (toasted || !summary || !showToast) return
      toasted = true
      try {
        await client.tui.showToast({
          body: { title: "Spark cost", message: summary, variant: "info" },
        })
      } catch {
        // TUI not attached (server/CI) — silent.
      }
    },
  }
}

export default SparkCost
