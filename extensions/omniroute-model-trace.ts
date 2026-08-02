/**
 * OmniRoute Model Trace — Pi extension
 *
 * OmniRoute combos (e.g. `fusion_free`) are not models. Each request is routed
 * to a real upstream model, which OmniRoute reports in the `x-omniroute-model`
 * response header. This extension captures that header via
 * `after_provider_response` and shows the real model in the footer:
 *
 *   while streaming:  fusion_free …
 *   when done:        fusion_free → deepseek-v4-flash-free
 *
 * Fallbacks when the header is missing:
 *   - Pi's recorded `responseModel` (also real when OmniRoute reports it)
 *   - "(gateway fallback)" when OmniRoute only reports the generic "omniroute"
 *
 * Command:
 *   /omni-model    — Show the real model of the last OmniRoute reply
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const STATUS_ID = "omni-model";
const GATEWAY_LABELS = new Set(["omniroute"]);

// Real models seen in `x-omniroute-model` headers, in arrival order.
let headerQueue: string[] = [];
// Queue length at the last omni message_start — pairs each header with the
// message that triggered it even when requests are in flight.
let snapshot = -1;
let lastLabel = "";

export default function (pi: ExtensionAPI) {
	// OmniRoute always reports the resolved upstream model in this header.
	pi.on("after_provider_response", (event: any) => {
		const real = event.headers?.["x-omniroute-model"];
		if (typeof real === "string" && real.trim()) {
			headerQueue.push(real.trim());
		}
	});

	// While an OmniRoute reply is streaming, show what Pi selected.
	pi.on("message_start", async (event: any, ctx: any) => {
		const m = event.message;
		if (m?.role !== "assistant" || m?.provider !== "omni") return;
		snapshot = headerQueue.length;
		ctx.ui.setStatus(STATUS_ID, `${m.model ?? ""} …`);
	});

	// When the reply finishes, reveal the real upstream model.
	pi.on("message_end", async (event: any, ctx: any) => {
		const m = event.message;
		if (m?.role !== "assistant" || m?.provider !== "omni") return;

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
