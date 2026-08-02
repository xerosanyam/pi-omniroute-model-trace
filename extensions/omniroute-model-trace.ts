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
// Queue length at the last omni message_start — pairs each header with the
// message that triggered it even when requests are in flight.
let snapshot = -1;
let lastLabel = "";
// Track which messages we've already found the model for (avoid duplicates)
let processedMessages = new Set<string>();

export default function (pi: ExtensionAPI) {
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
		processedMessages.delete(m.id);
		DBG({ ev: "start", model: m.model, snapshot, messageId: m.id });
		ctx.ui.setStatus(STATUS_ID, `${m.model ?? ""} …`);
	});

	// Process each chunk as it arrives. The first chunk contains the real model.
	pi.on("message_update", async (event: any, ctx: any) => {
		const m = event.message;
		if (m?.role !== "assistant" || m?.provider !== "omni") return;

		// Already found model for this message? Skip.
		if (processedMessages.has(m.id)) return;

		const partial = event.assistantMessageEvent?.partial;
		const chunkModel = partial?.model;
		
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
		if (snapshot >= 0 && headerQueue.length > snapshot) {
			// Header that arrived while THIS message was in flight.
			real = headerQueue[snapshot];
			headerQueue = headerQueue.slice(snapshot + 1);
		} else if (headerQueue.length) {
			real = headerQueue.pop() ?? "";
		} else {
			real = m.responseModel ?? "";
		}
		DBG({ ev: "end", model: m.model, responseModel: m.responseModel, queue: [...headerQueue], snapshot, computedReal: real, messageId: m.id });
		snapshot = -1;

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


