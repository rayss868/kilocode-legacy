// kilocode_change - new file
import type { ClineMessage } from "@roo-code/types"

/**
 * Returns the slice of messages to render in the chat for performance.
 *
 * When the full message list exceeds `limit`, only the task message (index 0)
 * plus the last `limit - 1` messages are returned. The full list is never
 * mutated and remains available upstream for accurate header metrics.
 *
 * @param messages The full message list.
 * @param limit The maximum number of messages to render.
 * @returns The messages to render.
 */
export function truncateMessagesForDisplay(messages: ClineMessage[], limit: number): ClineMessage[] {
	if (messages.length <= limit || limit <= 0) {
		return messages
	}
	// Keep the task message (messages[0]) plus the last (limit - 1) messages.
	// Note: slice(-0) behaves like slice(0), so guard against limit === 1.
	if (limit === 1) {
		return [messages[0]]
	}
	return [messages[0], ...messages.slice(-(limit - 1))]
}