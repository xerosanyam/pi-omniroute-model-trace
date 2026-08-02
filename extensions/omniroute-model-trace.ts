/**
 * OmniRoute Model Trace — Pi extension
 *
 * OmniRoute combos (e.g. `fusion_free`) are not models. Each request is routed
 * to a real upstream model, which OmniRoute reports in the `x-omniroute-model`
 * response header. This extension captures that header via
 * `after_provider_response` and shows the real model in the footer:
 *
 *   while streaming:  fusion_free … → gpt-4o (updated as first token arrives)
 *   when done:        fusion_free → gpt-4o
 *
 * Fallbacks when neither header nor SSE model is available:
 *   - Pi's recorded `responseModel` (also real when OmniRoute reports it)
 *   - "(gateway fallback)" when OmniRoute only reports the generic "omniroute"
 *
 * Command:
 *   /omni-model    — Show the real model that answered the last OmniRoute reply
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
const DBG = (x: any) => { try { fs.appendFileSync("/tmp/omni-live-debug.log", JSON.stringify(x) + "\n"); } catch {} };


const STATUS_ID = "omni-model";
const GATEWAY_LABELS = new Set(["omniroute"]);

// Real models seen in `x-omniroute-model` headers, in arrival order.
let headerQueue: string[] = [];
// Real models parsed from streaming SSE bodies, in arrival order.
let sseModelQueue: string[] = [];
// Queue length at the last omni message_start — pairs each header/model with
// the message that triggered it even when requests are in flight.
let snapshot = -1;
let sseSnapshot = -1;
let lastLabel = "";
// Track which messages we've already found the model for (avoid duplicates)
let processedMessages = new Set<string>();

// Install a fetch tee ONCE per process. pi-ai's `output.responseModel ||= chunk.model`
// latches on OmniRoute's keepalive chunk (model="omniroute"), so we sniff the
// real model straight out of the SSE stream on the way through.
let fetchPatched = false;
function installFetchTee() {
	if (fetchPatched) return;
	fetchPatched = true;
	const origFetch = globalThis.fetch;
	globalThis.fetch = async function patchedFetch(input: any, init?: any): Promise<Response> {
		const url = typeof input === "string" ? input : (input?.url ?? "");
		const res = await origFetch(input, init);
		try {
			if (!url.includes("/chat/completions") || !res.body) return res;
			const ct = res.headers.get("content-type") || "";
			if (!ct.includes("text/event-stream")) return res;
			// OmniRoute streaming detection: only tee if this looks like OmniRoute
			if (res.headers.get("x-omniroute-route-class") === null) return res;

			const [a, b] = res.body.tee();
			// Consume `b` in the background to sniff the first real model.
			(async () => {
				const reader = b.getReader();
				const decoder = new TextDecoder();
				let buf = "";
				try {
					while (true) {
						const { done, value } = await reader.read();
						if (done) break;
						buf += decoder.decode(value, { stream: true });
						let idx;
						while ((idx = buf.indexOf("\n")) !== -1) {
							const line = buf.slice(0, idx).trim();
							buf = buf.slice(idx + 1);
							if (!line.startsWith("data:")) continue;
							const payload = line.slice(5).trim();
							if (!payload || payload === "[DONE]") continue;
							try {
								const obj = JSON.parse(payload);
								const m = obj?.model;
								if (typeof m === "string" && m && !GATEWAY_LABELS.has(m)) {
									sseModelQueue.push(m);
									DBG({ ev: "sse_model", model: m });
									reader.cancel().catch(() => {});
									return;
								}
							} catch {}
						}
					}
				} catch {}
			})();
			return new Response(a, { status: res.status, statusText: res.statusText, headers: res.headers });
		} catch (e) {
			DBG({ ev: "tee_err", err: String(e) });
			return res;
		}
	};
}

export default function (pi: ExtensionAPI) {
	installFetchTee();

	// OmniRoute always reports the resolved upstream model in this header.
	// This is reliable for non-streaming and some streaming responses.
	pi.on("after_provider_response", (event: any) => {
		const real = event.headers?.["x-omniroute-model"];
		if (typeof real === "string" && real.trim()) {
			headerQueue.push(real.trim());
		}
		DBG({ ev: "apr", header: real ?? null, keys: Object.keys(event.headers ?? {}).filter(k => k.includes("omni")) });
	});

	// While an OmniRoute reply is streaming, show what Pi selected.
	pi.on("message_start", async (event: any, ctx: any) => {
		const m = event.message;
		if (m?.role !== "assistant" || m?.provider !== "omni") return;
		snapshot = headerQueue.length;
		sseSnapshot = sseModelQueue.length;
		processedMessages.delete(m.id);
		DBG({ ev: "start", model: m.model, snapshot, sseSnapshot, messageId: m.id });
		ctx.ui.setStatus(STATUS_ID, `${m.model ?? ""} …`);

		// Poll the sse queue: label the footer as soon as the first real model shows up.
		const pollStart = Date.now();
		const timer = setInterval(() => {
			if (processedMessages.has(m.id) || Date.now() - pollStart > 30000) {
				clearInterval(timer);
				return;
			}
			if (sseModelQueue.length > sseSnapshot) {
				const real = sseModelQueue[sseSnapshot];
				if (real && !GATEWAY_LABELS.has(real) && real !== m.model) {
					processedMessages.add(m.id);
					const combo = m.model ?? "";
					lastLabel = `${combo} → ${real}`;
					ctx.ui.setStatus(STATUS_ID, lastLabel);
					DBG({ ev: "sse_update", model: m.model, real, label: lastLabel, messageId: m.id });
					clearInterval(timer);
				}
			}
		}, 50);
	});

	// Process each chunk as it arrives. The first chunk contains the real model.
	pi.on("message_update", async (event: any, ctx: any) => {
		const m = event.message;
		if (m?.role !== "assistant" || m?.provider !== "omni") return;

		// Already found model for this message? Skip.
		if (processedMessages.has(m.id)) return;
		const chunkModel = m.responseModel;
		
		// Log for debugging
		DBG({
			ev: "update_check",
			messageId: m.id,
			model: m.model,
			responseModel: m.responseModel,
			partialModel: chunkModel,
			eventType: event.assistantMessageEvent?.type,
			processed: processedMessages.has(m.id),
			computedReal: "" // Will be set below
		});

		if (chunkModel && chunkModel.trim() && !GATEWAY_LABELS.has(chunkModel) && chunkModel !== m.model) {
			processedMessages.add(m.id);
			const combo = m.model ?? "";
			lastLabel = `${combo} → ${chunkModel}`;
			ctx.ui.setStatus(STATUS_ID, lastLabel);
			DBG({ ev: "update", model: m.model, chunkModel, label: lastLabel, messageId: m.id });
		}
	});

	// When the reply finishes, finalize with the best available model.
	pi.on("message_end", async (event: any, ctx: any) => {
		const m = event.message;
		if (m?.role !== "assistant" || m?.provider !== "omni") return;

		// Don't overwrite if we already have a better label from message_update
		if (processedMessages.has(m.id)) {
			snapshot = -1;
			DBG({ ev: "end_cached", model: m.model, responseModel: m.responseModel, label: lastLabel, messageId: m.id });
			return;
		}

		let real = "";
		// Prefer SSE-sniffed model (works for streaming even when the header is absent).
		if (sseSnapshot >= 0 && sseModelQueue.length > sseSnapshot) {
			real = sseModelQueue[sseSnapshot];
			sseModelQueue = sseModelQueue.slice(sseSnapshot + 1);
		} else if (snapshot >= 0 && headerQueue.length > snapshot) {
			// Header that arrived while THIS message was in flight.
			real = headerQueue[snapshot];
			headerQueue = headerQueue.slice(snapshot + 1);
		} else if (headerQueue.length) {
			real = headerQueue.pop() ?? "";
		} else {
			real = m.responseModel ?? "";
		}
		DBG({ ev: "end", model: m.model, responseModel: m.responseModel, queue: [...headerQueue], sseQueue: [...sseModelQueue], snapshot, sseSnapshot, computedReal: real, messageId: m.id });
		snapshot = -1;
		sseSnapshot = -1;

		const combo = m.model ?? "";
		if (GATEWAY_LABELS.has(real)) {
			lastLabel = combo ? `${combo} → (gateway fallback)` : "(gateway fallback)";
		} else if (real && real !== combo) {
			lastLabel = `${combo} → ${real}`;
		} else {
			lastLabel = real || combo;
		}
		ctx.ui.setStatus(STATUS_ID, lastLabel);
	});

	pi.registerCommand("omni-model", {
		description: "Show the real model that answered the last OmniRoute reply",
		handler: async (_args, ctx) => {
			if (!lastLabel) {
				ctx.ui.notify("No OmniRoute reply recorded yet. Send a message first.", "warning");
				return;
			}
			ctx.ui.notify(`Last OmniRoute reply: ${lastLabel}`, "info");
		},
	});
}


