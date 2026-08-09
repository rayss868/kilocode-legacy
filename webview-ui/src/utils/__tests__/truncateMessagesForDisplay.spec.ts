// kilocode_change - new file
import { truncateMessagesForDisplay } from "../truncateMessagesForDisplay"
import type { ClineMessage } from "@roo-code/types"

function makeMessages(count: number): ClineMessage[] {
	return Array.from({ length: count }, (_, i) => ({
		type: "say" as const,
		say: "text" as const,
		text: `message-${i}`,
		ts: i + 1,
	}))
}

describe("truncateMessagesForDisplay", () => {
	it("returns the full list when it is within the limit", () => {
		const messages = makeMessages(3)
		const result = truncateMessagesForDisplay(messages, 250)
		expect(result).toBe(messages)
		expect(result).toHaveLength(3)
	})

	it("returns the full list when it exactly matches the limit", () => {
		const messages = makeMessages(250)
		const result = truncateMessagesForDisplay(messages, 250)
		expect(result).toBe(messages)
		expect(result).toHaveLength(250)
	})

	it("keeps the task message (index 0) plus the last (limit - 1) messages", () => {
		const limit = 250
		const messages = makeMessages(700)
		const result = truncateMessagesForDisplay(messages, limit)

		expect(result).toHaveLength(limit)
		// Task message preserved
		expect(result[0]).toEqual(messages[0])
		// The remaining messages are the tail of the original list
		expect(result[1]).toEqual(messages[messages.length - (limit - 1)])
		expect(result[limit - 1]).toEqual(messages[messages.length - 1])
	})

	it("does not mutate the original list", () => {
		const limit = 250
		const messages = makeMessages(400)
		const before = [...messages]
		truncateMessagesForDisplay(messages, limit)
		expect(messages).toEqual(before)
		expect(messages).toHaveLength(400)
	})

	it("handles a limit of 1 by keeping only the task message", () => {
		const messages = makeMessages(5)
		const result = truncateMessagesForDisplay(messages, 1)
		expect(result).toHaveLength(1)
		expect(result[0]).toEqual(messages[0])
	})
})