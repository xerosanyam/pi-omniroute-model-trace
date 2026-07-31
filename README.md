# pi-omniroute-model-trace

A [Pi](https://pi.dev) package that shows the **real downstream model** behind [OmniRoute](https://github.com/diegosouzapw/OmniRoute) combos in Pi's footer.

## The problem

OmniRoute combos like `fusion_free` are not models — each request is routed to a real upstream model. Pi only knows the combo id, so "which model am I talking to?" is hard to answer.

## The fix

OmniRoute already reports the resolved model in the response, and Pi records it per message as `responseModel`. This extension surfaces it:

```text
while streaming:  fusion_free …
when done:        fusion_free → deepseek-v4-flash
gateway fallback: fusion_free → (gateway fallback)
```

## Install

From GitHub:

```bash
pi install git:github.com/xerosanyam/pi-omniroute-model-trace
```

Restart Pi after installation.

## Usage

The footer chip `omni-model` updates automatically after every OmniRoute reply. To re-show the last value as a notification:

```text
/omni-model
```

The package also ships a skill (`omniroute-model-trace`) that teaches the agent how to read `responseModel` from session files and interpret gateway fallback labels.

## Requirements

- Pi Coding Agent
- Pi routed through an OmniRoute provider (provider id `omni`), e.g. via the [omniroute-pi-ext-integration](https://www.npmjs.com/package/omniroute-pi-ext-integration) extension

## License

MIT
