---
name: omniroute-model-trace
description: Determine which real model answered through an OmniRoute gateway combo by reading the responseModel recorded on each assistant message and the footer status chip. Use when the user asks "which model replied", "what model am I talking to", wants to verify OmniRoute combo routing, or sees a combo name like fusion_free instead of the actual model.
license: MIT
compatibility: Requires the pi-omniroute-model-trace extension installed, with Pi routed through an OmniRoute provider (provider id "omni").
---

# OmniRoute Model Trace

When Pi talks through an OmniRoute combo (e.g. `fusion_free`), the message's `model` field holds the combo id, while the actual upstream model is recorded separately as `responseModel`.

## See the live model

After installing the extension and restarting Pi, each reply leaves a footer chip `omni-model`:

- while streaming: `fusion_free …`
- when done: `fusion_free → deepseek-v4-flash`
- gateway fallback: `fusion_free → (gateway fallback)` — OmniRoute answered without reporting a concrete upstream model

`/omni-model` prints the same value as a notification.

## Manual check (no extension)

The last assistant message of the latest session file:

```text
~/.pi/agent/sessions/<encoded-cwd>/<latest>.jsonl
```

contains `"responseModel"` and `"model"` keys:

```text
"model":"fusion_free","responseModel":"deepseek-v4-flash"
```

- `model` = what Pi selected (combo id)
- `responseModel` = what actually answered
- `/session` in Pi shows the per-model usage breakdown, using `responseModel` when present.

## What "omniroute" as responseModel means

`responseModel: "omniroute"` is NOT a model — it is the gateway's fallback label for a request answered without concrete upstream attribution (combo-level answer, quota fallback, cached reply). To find the real model:

- Open `/omni dashboard` and check the request logs
- List the combo members with the OmniRoute API: `GET /v1/combos` and inspect the `models` array of the combo

## Interpreting combos

`fusion_free` is a combo with `strategy: "fusion"` over 8 free models (e.g. `opencode-zen/deepseek-v4-flash-free`). The winner is chosen per request by the combo strategy; `responseModel` reveals which model answered each turn.
