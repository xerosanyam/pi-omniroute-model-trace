# pi-omniroute-model-trace

A [Pi](https://pi.dev) package that shows the **real downstream model** behind [OmniRoute](https://github.com/diegosouzapw/OmniRoute) combos in Pi's footer — updated **as soon as the first real token arrives**.

## The problem

OmniRoute combos like `auto/claude-sonnet`, `auto/coding:reliable`, or `fusion_free` are not models — each request is routed to a real upstream model. Pi only sees the combo id in `message.model`, so *"which model am I actually talking to?"* is surprisingly hard to answer at a glance.

Two things make it worse:

- OmniRoute's **streaming** responses only carry `x-omniroute-route-class` in HTTP headers. The real-model header (`x-omniroute-model`) is emitted as an SSE trailer comment at the end of the stream, which Pi's SSE parser drops.
- `pi-ai`'s OpenAI-completions parser writes `output.responseModel ||= chunk.model`. OmniRoute prepends a `model: "omniroute"` keepalive chunk, so `responseModel` **latches** to `"omniroute"` and never updates when the real model arrives in later chunks.

Net effect: on many combos, Pi's `responseModel` is stuck on the literal string `"omniroute"` for the entire stream.

## The fix

This extension patches `globalThis.fetch` once and `tee()`s any OmniRoute event-stream response, reading the real model straight out of the SSE body — before pi-ai's parser gets to it. As soon as a chunk arrives whose `model` isn't `"omniroute"`, the footer flips to `combo → real-model`.

```text
at request start:              auto/claude-sonnet …
after first real token:        auto/claude-sonnet → claude-opus-4-7
gateway fallback (only if OmniRoute never reveals a real model):
                               auto/claude-sonnet → (gateway fallback)
```

The fetch tee is **scoped**: it only activates for responses whose `content-type` is `text/event-stream` **and** which carry an `x-omniroute-route-class` header. Non-OmniRoute traffic is untouched.

For non-streaming responses the extension falls back to the `x-omniroute-model` header (via Pi's `after_provider_response` hook), then to `message.responseModel`.

## Install

From GitHub:

```bash
pi install git:github.com/xerosanyam/pi-omniroute-model-trace
```

Reload Pi (`/reload` in the TUI) or restart after installation.

## Usage

The footer chip `omni-model` updates automatically after every OmniRoute reply. To re-show the last value as a notification:

```text
/omni-model
```

The package also ships a skill (`omniroute-model-trace`) that teaches the agent how the extension resolves the real model and how to cross-check via session files, gateway call logs, or a direct curl to the gateway.

## Requirements

- Pi Coding Agent
- Pi routed through an OmniRoute provider (provider id `omni`), e.g. via the [omniroute-pi-ext-integration](https://www.npmjs.com/package/omniroute-pi-ext-integration) extension

## License

MIT
