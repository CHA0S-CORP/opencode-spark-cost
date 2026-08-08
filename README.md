# opencode-spark-cost

Show the **electricity cost** of running a local/offline model in
[opencode](https://opencode.ai)'s native cost badge.

Local models served by vLLM/sglang (e.g. on an NVIDIA **DGX Spark**) report
`$0.00` — you're not paying an API, but you *are* paying the power company.
This plugin fills the badge in with real energy cost from your measured power
draw, model throughput, and time-of-use utility rate.

```
$/1M tokens = watts × price_$perkWh / (3.6 × tokens_per_sec)
```

Prefill (input) and decode (output) are priced separately because prefill is
much faster per token, and therefore cheaper.

## Install

opencode auto-loads plugins from `~/.config/opencode/plugins/` (global) or
`.opencode/plugins/` (per project). Two ways:

**A. npm package (recommended)** — add to `opencode.json`:

```json
{
  "plugin": [
    ["opencode-spark-cost", {
      "provider": "ling-codellm",
      "model": "ling-3.0-flash",
      "watts": 30,
      "outputTps": 20,
      "prefillTps": 70
    }]
  ]
}
```

Install from GitHub:

```bash
npm i -D github:CHA0S-CORP/opencode-spark-cost
```

**B. Drop-in file** — copy `src/index.ts` to
`~/.config/opencode/plugins/spark-cost.ts` and edit the constants at the top.
Configure via the `SPARK_*` env vars (see below) since drop-in gets no options.

Relaunch opencode. A toast shows the picked bracket at startup.

## Measure your numbers

You need three real values. Defaults are placeholders — **measure yours.**

**Watts** — marginal draw while generating, i.e. active − idle. On the Spark:

```bash
nvidia-smi --query-gpu=power.draw --format=csv -l 1
```

Run a generation, note the steady active watts, subtract idle. Idle burns
regardless, so the *marginal* number is the honest cost of a request. Multiply
by ~1.3–1.5 if you want wall power (PSU + cooling), not just GPU.

**Throughput** — sglang/vLLM log it per batch:

```
Decode batch  ... gen throughput (token/s): 20.37     ← outputTps
Prefill batch ... input throughput (token/s): 90.44   ← prefillTps
```

**Rate** — your utility's $/kWh. Default is SDG&E TOU-DR-1 Tier 1 (San Diego).
Override `weekday`/`weekend`, or set a single `flat` rate.

## Options

| Option | Env | Default | Meaning |
|--------|-----|---------|---------|
| `provider` | `SPARK_PROVIDER` | `ling-codellm` | Provider id in your opencode config |
| `model` | `SPARK_MODEL` | `ling-3.0-flash` | Model id under that provider |
| `allModels` | `SPARK_ALL_MODELS` | `false` | Apply to every model of the provider |
| `watts` | `SPARK_WATTS` | `30` | Marginal draw while generating (W) |
| `outputTps` | `SPARK_OUTPUT_TPS` | `20` | Decode throughput (output tok/s) |
| `prefillTps` | `SPARK_PREFILL_TPS` | `70` | Prefill throughput (input tok/s) |
| `flat` | `SPARK_FLAT_RATE` | — | Single $/kWh, overrides the TOU schedule |
| `weekday` | — | SDG&E | TOU brackets, weekdays (options only) |
| `weekend` | — | SDG&E | TOU brackets, weekends (options only) |
| `toast` | `SPARK_TOAST` | `true` | Show startup toast |

### Custom TOU schedule

```json
["opencode-spark-cost", {
  "provider": "ling-codellm",
  "weekday": [
    { "price": 0.12, "label": "off-peak",   "hours": [[0, 16], [21, 24]] },
    { "price": 0.34, "label": "peak",        "hours": [[16, 21]] }
  ],
  "weekend": [
    { "price": 0.12, "label": "off-peak", "hours": [[0, 24]] }
  ]
}]
```

Or just a flat rate:

```json
["opencode-spark-cost", { "flat": 0.15, "watts": 30, "outputTps": 20 }]
```

## Cumulative cost

**Per session** — native. Once this plugin sets `cost`, opencode's session
cost badge sums every message automatically. Nothing to do.

**Lifetime, across all sessions** — opencode persists every message (with its
`cost`, priced at whatever rate was active when generated) in its SQLite store.
`scripts/spark-total.sh` sums them:

```bash
./scripts/spark-total.sh                     # all providers
./scripts/spark-total.sh --provider ling-codellm
```

```
┌──────────────┬────────────────┬──────┬─────────┬────────┬─────────┐
│   provider   │     model      │ msgs │  cost   │ in_tok │ out_tok │
├──────────────┼────────────────┼──────┼─────────┼────────┼─────────┤
│ ling-codellm │ ling-3.0-flash │ 52   │ $0.0022 │ 737004 │ 10154   │
└──────────────┴────────────────┴──────┴─────────┴────────┴─────────┘
TOTAL: $0.0022 across 52 messages
```

Requires `sqlite3`. Reads `~/.local/share/opencode/opencode.db` (override with
`--db` or `$OPENCODE_DB`). Only messages generated *after* the plugin is
installed carry cost; earlier ones count as $0.

## Caveats

- **Rate is picked once, at launch.** The `config` hook fires at startup only,
  so if you cross a TOU boundary (e.g. 4 pm) mid-session, relaunch opencode to
  re-price. Live intra-session re-pricing isn't exposed by the plugin API.
- **Static throughput.** Real tok/s varies with batch size and context length;
  this uses your one measured number.
- **Marginal, not total.** Idle draw is excluded by design. Include it (and a
  PSU/cooling multiplier) in `watts` if you want fully-loaded cost.

## Example (DGX Spark, Ling 3.0 Flash)

Measured: idle ~14 W, active ~44 W → **30 W** marginal. Decode **20 tok/s**,
prefill **70 tok/s**. SDG&E off-peak **35.7¢/kWh**:

```
output: 30 × 0.357 / (3.6 × 20) = $0.149 / 1M tokens
input:  30 × 0.357 / (3.6 × 70) = $0.043 / 1M tokens
```

Pennies per million tokens. The Spark is cheap to run.

## License

MIT © CHA0S-CORP
