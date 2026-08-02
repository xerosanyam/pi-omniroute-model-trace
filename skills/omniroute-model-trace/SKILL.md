---
name: omniroute-model-trace
description: Determine which real model answered through an OmniRoute gateway combo. Use when the user asks "which model replied", "what model am I talking to", wants to verify OmniRoute combo routing, or sees a combo name like auto/claude-sonnet or fusion_free instead of the actual model.
license: MIT
compatibility: Requires the pi-omniroute-model-trace extension installed, with Pi routed through an OmniRoute provider (provider id "omni").
---

# OmniRoute Model Trace

When Pi talks through an OmniRoute combo (e.g. `auto/claude-sonnet`, `fusion_free`), the
message's `model` field holds the **combo id**, while the actual upstream model is chosen
per request by the gateway. This extension surfaces the real model in the footer as soon
as the first real token arrives.

## See the live model

Each reply leaves a footer chip `omni-model`:

- at request start: `auto/claude-sonnet …`
- after the first real token: `auto/claude-sonnet → claude-opus-4-7`
- gateway fallback (only if OmniRoute never reveals a real model): `auto/claude-sonnet → (gateway fallback)`

`/omni-model` prints the same value as a notification.

## How it gets the real model

Sources, in priority order:

1. **SSE tee (primary, streaming).** The extension patches `globalThis.fetch` once and
   `tee()`s any OmniRoute event-stream response, reading the real model directly out of
   the `data: {... "model": ...}` chunks.
2. **`x-omniroute-model` response header** via `after_provider_response` — present on
   **non-streaming** responses only.
3. **`message.responseModel`** — only correct when no keepalive chunk preceded the real one.
4. `(gateway fallback)` when nothing above yields a real model.

### Why the header alone is not enough

OmniRoute streaming responses only send `x-omniroute-route-class` in HTTP headers; the
meta headers (`x-omniroute-model`, etc.) are emitted as **SSE trailer comments** at the
end of the stream, which Pi's SSE parser discards. Pi's `after_provider_response` hook
also exposes only `status` and `headers` — never the body.

### Why `responseModel` is often stuck on "omniroute"

`pi-ai`'s `openai-completions` parser does:

```js
output.responseModel ||= chunk.model;
```

The `||=` means **the first non-empty model wins**. OmniRoute prepends a keepalive chunk:

```json
{"id":"omniroute-keepalive","model":"omniroute","choices":[{"delta":{}}]}
```

so `responseModel` latches to `"omniroute"` permanently and later chunks carrying the real
model are ignored. Routes without a keepalive resolve correctly, which is why the symptom
is intermittent and looks route-dependent.

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
- `responseModel` = what actually answered (subject to the keepalive caveat above)
- `/session` shows the per-model usage breakdown, using `responseModel` when present.

Ground truth independent of Pi is the gateway's own call logs:

```text
~/.omniroute/call_logs/<YYYY-MM-DD>/*.json   → summary.model, summary.comboName
```

You can also confirm routing directly:

```bash
curl -sN -X POST http://localhost:20128/v1/chat/completions \
  -H "Authorization: Bearer $OMNI_KEY" -H 'Content-Type: application/json' \
  -d '{"model":"auto/claude-sonnet","stream":true,"messages":[{"role":"user","content":"hi"}],"max_tokens":5}' \
  | grep -o '"model":"[^"]*"' | sort -u
```

## What "omniroute" as responseModel means

`responseModel: "omniroute"` is NOT a model — it is the gateway's placeholder (usually from
the keepalive chunk, or a reply without concrete upstream attribution). To find the real model:

- Check `~/.omniroute/call_logs/` for the matching request
- Open the OmniRoute dashboard request logs
- List combo members via the OmniRoute API: `GET /v1/combos`, inspect the `models` array

## Interpreting combos

A combo such as `fusion_free` (strategy `fusion`) spans several models; the winner is chosen
per request by the combo strategy. Routing is dynamic — the same combo can resolve to a
different model on consecutive turns, so always read the per-turn value rather than assuming.
