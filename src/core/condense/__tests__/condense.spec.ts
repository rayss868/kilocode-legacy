// npx vitest src/core/condense/__tests__/condense.spec.ts

import { Anthropic } from "@anthropic-ai/sdk"
import type { ModelInfo } from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"

import { BaseProvider } from "../../../api/providers/base-provider"
import { ApiMessage } from "../../task-persistence/apiMessages"
import {
	summarizeConversation,
	getMessagesSinceLastSummary,
	getEffectiveApiHistory,
	N_MESSAGES_TO_KEEP,
} from "../index"

// Create a mock ApiHandler for testing
class MockApiHandler extends BaseProvider {
	createMessage(): any {
		// Mock implementation for testing - returns an async iterable stream
		const mockStream = {
			async *[Symbol.asyncIterator]() {
				yield { type: "text", text: "Mock summary of the conversation" }
				yield { type: "usage", inputTokens: 100, outputTokens: 50, totalCost: 0.01 }
			},
		}
		return mockStream
	}

	getModel(): { id: string; info: ModelInfo } {
		return {
			id: "test-model",
			info: {
				contextWindow: 100000,
				maxTokens: 50000,
				supportsPromptCache: true,
				supportsImages: false,
				inputPrice: 0,
				outputPrice: 0,
				description: "Test model",
			},
		}
	}

	override async countTokens(content: Array<Anthropic.Messages.ContentBlockParam>): Promise<number> {
		// Simple token counting for testing
		let tokens = 0
		for (const block of content) {
			if (block.type === "text") {
				tokens += Math.ceil(block.text.length / 4) // Rough approximation
			}
		}
		return tokens
	}
}

const mockApiHandler = new MockApiHandler()
const taskId = "test-task-id"

// kilocode_change: builds enough messages to pass the N_MESSAGES_TO_KEEP + 2 guard
function buildMessages(
	count: number,
	firstContent?: string | Anthropic.Messages.ContentBlockParam[],
): ApiMessage[] {
	return Array.from({ length: count }, (_, i) => ({
		role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
		content: i === 0 && firstContent !== undefined ? firstContent : `Message ${i + 1}`,
		ts: i + 1,
	}))
}

describe("Condense", () => {
	beforeEach(() => {
		if (!TelemetryService.hasInstance()) {
			TelemetryService.createInstance([])
		}
	})

	describe("summarizeConversation", () => {
		it("should preserve the first message when summarizing", async () => {
			const messages = buildMessages(14, "First message with /prr command content")

			const result = await summarizeConversation(messages, mockApiHandler, "System prompt", taskId, 5000, false)

			// Verify the first message is preserved
			expect(result.messages[0]).toEqual(messages[0])
			expect(result.messages[0].content).toBe("First message with /prr command content")

			// Verify we have a summary message
			const summaryMessage = result.messages.find((msg) => msg.isSummary)
			expect(summaryMessage).toBeTruthy()
			// Summary content is now always an array with a synthetic reasoning block + text block
			// for DeepSeek-reasoner compatibility
			expect(Array.isArray(summaryMessage?.content)).toBe(true)
			const contentArray = summaryMessage?.content as Anthropic.Messages.ContentBlockParam[]
			expect(contentArray).toHaveLength(2)
			expect(contentArray[0]).toEqual({
				type: "reasoning",
				text: "Condensing conversation context. The summary below captures the key information from the prior conversation.",
			})
			expect(contentArray[1]).toEqual({
				type: "text",
				text: "Mock summary of the conversation",
			})

			// With non-destructive condensing, all messages are retained (tagged but not deleted)
			// Use getEffectiveApiHistory to verify the effective view matches the old behavior
			expect(result.messages.length).toBe(messages.length + 1) // All original messages + summary
			const effectiveHistory = getEffectiveApiHistory(result.messages)
			expect(effectiveHistory.length).toBe(1 + 1 + N_MESSAGES_TO_KEEP) // first + summary + last N

			// Verify the last N messages are preserved (same messages by reference)
			const lastMessages = result.messages.slice(-N_MESSAGES_TO_KEEP)
			expect(lastMessages).toEqual(messages.slice(-N_MESSAGES_TO_KEEP))
		})

		it("should preserve slash command content in the first message", async () => {
			const slashCommandContent = "/prr #123 - Fix authentication bug"
			const messages: ApiMessage[] = [
				{ role: "user", content: slashCommandContent },
				{ role: "assistant", content: "I'll help you fix that authentication bug" },
				{ role: "user", content: "The issue is with JWT tokens" },
				{ role: "assistant", content: "Let me examine the JWT implementation" },
				{ role: "user", content: "It's failing on refresh" },
				{ role: "assistant", content: "I found the issue" },
				{ role: "user", content: "Great, can you fix it?" },
				{ role: "assistant", content: "Here's the fix" },
				{ role: "user", content: "Thanks!" },
			]

			const result = await summarizeConversation(messages, mockApiHandler, "System prompt", taskId, 5000, false)

			// The first message with slash command should be intact
			expect(result.messages[0].content).toBe(slashCommandContent)
			expect(result.messages[0]).toEqual(messages[0])
		})

		it("should handle complex first message content", async () => {
			const complexContent: Anthropic.Messages.ContentBlockParam[] = [
				{ type: "text", text: "/mode code" },
				{ type: "text", text: "Additional context from the user" },
			]

			const messages: ApiMessage[] = [
				{ role: "user", content: complexContent },
				{ role: "assistant", content: "Switching to code mode" },
				{ role: "user", content: "Write a function" },
				{ role: "assistant", content: "Here's the function" },
				{ role: "user", content: "Add error handling" },
				{ role: "assistant", content: "Added error handling" },
				{ role: "user", content: "Add tests" },
				{ role: "assistant", content: "Tests added" },
				{ role: "user", content: "Perfect!" },
			]

			const result = await summarizeConversation(messages, mockApiHandler, "System prompt", taskId, 5000, false)

			// The first message with complex content should be preserved
			expect(result.messages[0].content).toEqual(complexContent)
			expect(result.messages[0]).toEqual(messages[0])
		})

		it("should return error when not enough messages to summarize", async () => {
			const messages: ApiMessage[] = [
				{ role: "user", content: "First message with /command" },
				{ role: "assistant", content: "Second message" },
				{ role: "user", content: "Third message" },
				{ role: "assistant", content: "Fourth message" },
			]

			const result = await summarizeConversation(messages, mockApiHandler, "System prompt", taskId, 5000, false)

			// Should return an error since we have only 4 messages (first + 3 to keep)
			expect(result.error).toBeDefined()
			expect(result.messages).toEqual(messages) // Original messages unchanged
			expect(result.summary).toBe("")
		})

		it("should not summarize messages that already contain a recent summary", async () => {
			const messages: ApiMessage[] = [
				{ role: "user", content: "First message with /command" },
				{ role: "assistant", content: "Old message" },
				{ role: "user", content: "Message before summary" },
				{ role: "assistant", content: "Response" },
				{ role: "user", content: "Another message" },
				{ role: "assistant", content: "Previous summary", isSummary: true }, // Summary in last N messages
				{ role: "user", content: "Final message" },
			]

			const result = await summarizeConversation(messages, mockApiHandler, "System prompt", taskId, 5000, false)

			// Should return an error due to recent summary in last N messages
			expect(result.error).toBeDefined()
			expect(result.messages).toEqual(messages)
			expect(result.summary).toBe("")
		})

		it("should handle empty summary from API gracefully", async () => {
			// Mock handler that returns empty summary
			class EmptyMockApiHandler extends MockApiHandler {
				override createMessage(): any {
					const mockStream = {
						async *[Symbol.asyncIterator]() {
							yield { type: "text", text: "" }
							yield { type: "usage", inputTokens: 100, outputTokens: 0, totalCost: 0.01 }
						},
					}
					return mockStream
				}
			}

			const emptyHandler = new EmptyMockApiHandler()
			const messages = buildMessages(14)

			const result = await summarizeConversation(messages, emptyHandler, "System prompt", taskId, 5000, false)

			expect(result.error).toBeDefined()
			expect(result.messages).toEqual(messages)
			expect(result.cost).toBeGreaterThan(0)
		})
	})

	describe("getMessagesSinceLastSummary", () => {
		it("should return all messages when no summary exists", () => {
			const messages: ApiMessage[] = [
				{ role: "user", content: "First message" },
				{ role: "assistant", content: "Second message" },
				{ role: "user", content: "Third message" },
			]

			const result = getMessagesSinceLastSummary(messages)
			expect(result).toEqual(messages)
		})

		it("should return messages since last summary including the summary", () => {
			const messages: ApiMessage[] = [
				{ role: "user", content: "First message" },
				{ role: "assistant", content: "Second message" },
				{ role: "assistant", content: "Summary content", isSummary: true },
				{ role: "user", content: "Message after summary" },
				{ role: "assistant", content: "Final message" },
			]

			const result = getMessagesSinceLastSummary(messages)

			// Should include the original first user message for context preservation, the summary, and messages after
			expect(result[0].role).toBe("user")
			expect(result[0].content).toBe("First message") // Preserves original first message
			expect(result[1]).toEqual(messages[2]) // The summary
			expect(result[2]).toEqual(messages[3])
			expect(result[3]).toEqual(messages[4])
		})

		it("should handle multiple summaries and return from the last one", () => {
			const messages: ApiMessage[] = [
				{ role: "user", content: "First message" },
				{ role: "assistant", content: "First summary", isSummary: true },
				{ role: "user", content: "Middle message" },
				{ role: "assistant", content: "Second summary", isSummary: true },
				{ role: "user", content: "Recent message" },
				{ role: "assistant", content: "Final message" },
			]

			const result = getMessagesSinceLastSummary(messages)

			// Should only include from the last summary with original first message preserved
			expect(result[0].role).toBe("user")
			expect(result[0].content).toBe("First message") // Preserves original first message
			expect(result[1]).toEqual(messages[3]) // Second summary
			expect(result[2]).toEqual(messages[4])
			expect(result[3]).toEqual(messages[5])
		})
	})

	describe("keep the most recent messages on a realistic user session", () => {
		// Mirrors a real long session: a first message with the project recap, many
		// interleaved user/assistant messages with tool_use/tool_result pairs, a giant
		// "Task Completed" recap near the end, and a final short user ask.
		// Regression: after condensing, the API must still receive the last N real
		// messages (plus first + summary), not just the beginning of the conversation.
		function buildRealisticSession(count: number): ApiMessage[] {
			const giantRecap =
				"Task Completed — Project sudah dibaca menggunakan MCP Codebase Memory pada project sekawan-catalog. " +
				"Ringkasan hasil analisis: Stack utama: CodeIgniter 4 dengan PHP, ditambah CSS, HTML, JavaScript, dan SQL. " +
				"Ukuran graph: 1.314 nodes dan 3.035 edges."
			const messages: ApiMessage[] = [{ role: "user", content: giantRecap, ts: 1 }]
			for (let i = 1; i < count - 1; i++) {
				if (i % 3 === 0) {
					messages.push({
						role: "assistant",
						content: [
							{ type: "text", text: `Work on question center item ${i}` },
							{ type: "tool_use", id: `tool-${i}`, name: "read_file", input: { path: "/app/detail.php" } },
						],
						ts: i + 1,
					})
				} else if (i % 3 === 1) {
					messages.push({
						role: "user",
						content: [{ type: "tool_result", tool_use_id: `tool-${i - 1}`, content: "file contents here" }],
						ts: i + 1,
					})
				} else {
					messages.push({ role: "assistant", content: `Task Completed — continued work ${i}`, ts: i + 1 })
				}
			}
			// Last message is the user's recent ask
			messages.push({ role: "user", content: "ini harusnya gak ada kalau bukan admin", ts: count })
			return messages
		}

		it("should keep the last N messages of a long session with giant recap messages", async () => {
			const messages = buildRealisticSession(48)

			const result = await summarizeConversation(messages, mockApiHandler, "System prompt", taskId, 200000, false)

			expect(result.error).toBeUndefined()

			const effectiveHistory = getEffectiveApiHistory(result.messages)

			// first message + summary + last N kept messages
			expect(effectiveHistory.length).toBe(2 + N_MESSAGES_TO_KEEP)

			// The first message is preserved verbatim
			expect(effectiveHistory[0]).toEqual(messages[0])
			expect((effectiveHistory[1] as { isSummary?: boolean }).isSummary).toBe(true)

			// The actual last N real messages (the recent conversation) are preserved in order
			expect(effectiveHistory.slice(-N_MESSAGES_TO_KEEP)).toEqual(messages.slice(-N_MESSAGES_TO_KEEP))

			// What the API ultimately receives: [first, summary, ...last N] - the recent ask
			// and the messages right before it survive condensing.
			const requestHistory = getMessagesSinceLastSummary(effectiveHistory)
			expect(requestHistory[0]).toEqual(messages[0])
			expect((requestHistory[1] as { isSummary?: boolean }).isSummary).toBe(true)
			expect(requestHistory.slice(-N_MESSAGES_TO_KEEP)).toEqual(messages.slice(-N_MESSAGES_TO_KEEP))
			expect(requestHistory[requestHistory.length - 1]).toEqual(messages[messages.length - 1])
		})

		it("should keep the recent ask even when the tail is full of giant recaps", async () => {
			const messages = buildRealisticSession(60)

			const result = await summarizeConversation(messages, mockApiHandler, "System prompt", taskId, 200000, false)

			expect(result.error).toBeUndefined()

			const requestHistory = getMessagesSinceLastSummary(getEffectiveApiHistory(result.messages))

			// The final user message (recent ask) must be present after condensing
			expect(requestHistory[requestHistory.length - 1].content).toBe("ini harusnya gak ada kalau bukan admin")
		})
	})
})
