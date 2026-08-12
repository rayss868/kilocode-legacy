// kilocode_change - new file
import type { AssistantMessageContent } from "../assistant-message"
import type { McpToolUse, ToolUse } from "../../shared/tools"

/**
 * Detects when the model gets stuck repeating the same tool call over and over.
 *
 * Each completed assistant turn is fed via `update()`. A stable signature is
 * derived from the turn's tool calls (name + parameters); consecutive turns
 * with an identical signature count as repeats. Once `maxRepeats` consecutive
 * identical turns are seen, the detector returns an intervention:
 *
 * - "intervene" while interventions remain — the caller should inject a fresh
 *   directive into the next request to break the loop.
 * - "stop" once `maxInterventions` have been spent — the caller should end the
 *   task, since guidance alone is not breaking the loop.
 *
 * Turns without any tool call reset the repeat counter (a pure text turn is not
 * a looping tool call).
 */
export class LoopDetector {
	private lastSignature: string | undefined
	private repeatCount = 0
	private interventionCount = 0

	constructor(
		private readonly maxRepeats = 3,
		private readonly maxInterventions = 2,
	) {}

	get currentRepeatCount(): number {
		return this.repeatCount
	}

	get currentInterventionCount(): number {
		return this.interventionCount
	}

	/**
	 * Feeds one completed assistant turn. Returns the action the caller should
	 * take, or undefined when no loop is detected.
	 */
	update(content: AssistantMessageContent[]): "intervene" | "stop" | undefined {
		// A maxRepeats of 0 (or less) means the feature is effectively disabled.
		if (this.maxRepeats <= 0) {
			return undefined
		}
		const signature = this.computeSignature(content)
		if (signature === undefined) {
			this.lastSignature = undefined
			this.repeatCount = 0
			return undefined
		}

		if (signature === this.lastSignature) {
			this.repeatCount++
		} else {
			this.lastSignature = signature
			this.repeatCount = 1
		}

		if (this.repeatCount >= this.maxRepeats) {
			if (this.interventionCount < this.maxInterventions) {
				this.interventionCount++
				this.repeatCount = 0 // re-arm: the next identical call re-triggers detection
				return "intervene"
			}
			return "stop"
		}
		return undefined
	}

	private computeSignature(content: AssistantMessageContent[]): string | undefined {
		const toolBlocks = content.filter(
			(block): block is ToolUse | McpToolUse => block.type === "tool_use" || block.type === "mcp_tool_use",
		)
		if (toolBlocks.length === 0) {
			return undefined
		}
		return toolBlocks
			.map((block) => {
				if (block.type === "mcp_tool_use") {
					return `mcp:${block.name}:${stableJson(block.arguments)}`
				}
				return `${block.name}:${stableJson(block.params)}:${block.nativeArgs !== undefined ? stableJson(block.nativeArgs) : ""}`
			})
			.join("|")
	}
}

/**
 * Stable, length-capped JSON serialization so the signature stays small even
 * for calls carrying large payloads (file contents, command output, ...).
 */
function stableJson(value: unknown): string {
	if (value === undefined) {
		return ""
	}
	return JSON.stringify(value).slice(0, 400)
}
