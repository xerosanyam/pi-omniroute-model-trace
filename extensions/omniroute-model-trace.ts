/**
 * OmniRoute Model Trace — Pi extension
 *
 * OmniRoute combos (e.g. `fusion_free`) are not models. Each request is routed
 * to a real upstream model, which OmniRoute reports back in the response. Pi's
 * message records that as `responseModel` (the combo id stays in `model`).
 *
 * This extension surfaces the real model in the footer after every reply:
 *   while streaming:  fusion_free …
 *   when done:        fusion_free → deepseek-v4-flash
 *   gateway fallback: fusion_free → (gateway fallback)
 *
 * Command:
 *   /omni-model    — Show the real model of the last OmniRoute reply
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const STATUS_ID = "omni-model";
const GATEWAY_LABELS = new Set(["omniroute"]);

let lastLabel = "";

export default function (pi: ExtensionAPI) {
	// While an OmniRoute reply is streaming, show what Pi selected.
	pi.on("message_start", async (event: any, ctx: any) => {
		const m = event.message;
		if (m?.role !== "assistant" || m?.provider !== "omni") return;
		ctx.ui.setStatus(STATUS_ID, `${m.model ?? ""} …`);
	});

	// When the reply finishes, reveal the real upstream model.
	pi.on("message_end", async (event: any, ctx: any) => {
		const m = event.message;
		if (m?.role !== "assistant" || m?.provider !== "omni") return;
		const combo = m.model || "";
		const real = m.responseModel || combo;
		if (!combo && !real) return;
		if (GATEWAY_LABELS.has(real)) {
			lastLabel = `${combo} → (gateway fallback)`;
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
