# opencode-spark-cost

[![CI](https://github.com/CHA0S-CORP/opencode-spark-cost/actions/workflows/ci.yml/badge.svg)](https://github.com/CHA0S-CORP/opencode-spark-cost/actions/workflows/ci.yml)

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

**A. npm package (recommended).** opencode installs plugins listed in the
`plugin` array automatically (via Bun) at startup — no manual `npm install`.
Add the package to `opencode.json`, with options as the second tuple element:

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

Pin a version if you like: `"opencode-spark-cost@0.1.0"`. Relaunch opencode; a
toast shows your spend + the picked rate at startup. (opencode's plugin array
takes npm package names only — no options, no periods toast tuning — if you use
the bare-string form `"opencode-spark-cost"`; the tuple form above passes
options.)

**B. Drop-in file (no npm).** Copy `src/index.ts` to
`~/.config/opencode/plugins/spark-cost.ts` (global) or `.opencode/plugins/` in a
project. A drop-in gets no options object, so configure it with the `SPARK_*`
env vars (see the table below).

Either way, relaunch opencode to load it.

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

Decode is steady; prefill swings a lot (it's contaminated by fast cache-hit
tokens). Take a representative decode figure and a conservative prefill one —
the shipped defaults (20 / 70) are a rounded middle of a real Spark, not the
single log line above.

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

**Launch toast** — on the first event each session the plugin toasts your spend
so far: `Today $… · Week $… · Month $…` plus the current rate. Totals come from
opencode's SQLite store (read-only, via the built-in `bun:sqlite`); if it can't
be opened the toast falls back to just the rate line.

**Per session** — native. Once this plugin sets `cost`, opencode's session
cost badge sums every message automatically. Nothing to do.

**Lifetime, across all sessions** — opencode persists every message (with its
`cost`, priced at whatever rate was active when generated) in its SQLite store.
`scripts/spark-total.sh` sums them:

```bash
./scripts/spark-total.sh                 # by provider/model + grand TOTAL
./scripts/spark-total.sh --by-session    # per-session table (title/model/cost/tokens)
./scripts/spark-total.sh --periods       # today / this week / this month / all time
./scripts/spark-total.sh --provider ling-codellm   # filter to one provider
```

### `/spark-usage` slash command

`commands/spark-usage.md` is an opencode command that runs the script and prints
the periods + by-session + by-model breakdown in-chat. Install it:

```bash
mkdir -p ~/.config/opencode/{bin,commands}
cp scripts/spark-total.sh ~/.config/opencode/bin/ && chmod +x ~/.config/opencode/bin/spark-total.sh
cp commands/spark-usage.md ~/.config/opencode/commands/
```

Then type `/spark-usage` in opencode. (The command shells out to
`~/.config/opencode/bin/spark-total.sh`; edit the paths in the `.md` if you keep
the script elsewhere.)

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

## Reference: SDG&E TOU-DR-1 (DGX Spark, Ling 3.0 Flash)

Worked out for the **default config** — SDG&E TOU-DR-1 Tier 1 (San Diego),
30 W marginal, decode 20 tok/s, prefill 70 tok/s, cached input free. These are
the exact numbers this repo ships with; swap the rate/throughput for your own.

**Cost per 1M tokens**

| SDG&E slot     | Rate   | $/1M output | $/1M input | $/1M cached |
|----------------|--------|-------------|------------|-------------|
| Super-off-peak | 26.7¢  | $0.1113     | $0.0318    | $0.0000     |
| Off-peak       | 35.7¢  | $0.1488     | $0.0425    | $0.0000     |
| On-peak        | 58.4¢  | $0.2433     | $0.0695    | $0.0000     |

**Tokens per penny ($0.01)**

| SDG&E slot     | Rate   | Output tok / 1¢ | Input tok / 1¢ |
|----------------|--------|-----------------|----------------|
| Super-off-peak | 26.7¢  | ~89,900         | ~314,600       |
| Off-peak       | 35.7¢  | ~67,200         | ~235,300       |
| On-peak        | 58.4¢  | ~41,100         | ~143,800       |

On-peak costs **2.19×** super-off-peak — run overnight for the cheapest tokens.
For scale, hosted frontier models bill ~$5–15 / 1M output; the Spark on-peak is
**$0.24 / 1M**, ~20–60× cheaper per token on energy alone (hardware not amortized).

## Development

```bash
bun install          # dev deps (@opencode-ai/plugin, typescript)
bun run typecheck    # tsc --noEmit
bun test             # unit tests (pricing, TOU brackets, cost injection)
bun run check        # typecheck + test
npm pack             # build the publishable tarball
```

CI (`.github/workflows/ci.yml`) runs typecheck, tests, ShellCheck, and `npm
pack` on every push/PR. Publishing is automated: push a `vX.Y.Z` tag and
`release.yml` publishes to npm with provenance (needs an `NPM_TOKEN` repo
secret) and cuts a GitHub release.

```bash
npm version patch    # bumps package.json + tags
git push --follow-tags
```

## License

MIT © CHA0S-CORP
