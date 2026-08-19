import { describe, it, expect, beforeEach, vi } from "vitest"

const mocks = vi.hoisted(() => ({
	loadSkillHandle: vi.fn(),
}))

vi.mock("../../task/Task")
vi.mock("../../tools/validateToolUse", () => ({
	validateToolUse: vi.fn(),
}))
vi.mock("../../tools/LoadSkillTool", () => ({
	loadSkillTool: {
		handle: mocks.loadSkillHandle,
	},
}))
vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: {
		instance: {
			captureToolUsage: vi.fn(),
			captureConsecutiveMistakeError: vi.fn(),
		},
	},
}))

import { presentAssistantMessage } from "../presentAssistantMessage"

describe("presentAssistantMessage - load_skill dispatch", () => {
	let mockTask: any

	beforeEach(() => {
		mocks.loadSkillHandle.mockReset()
		mocks.loadSkillHandle.mockImplementation(async (_task: any, _block: any, callbacks: any) => {
			callbacks.pushToolResult("loaded")
		})

		mockTask = {
			taskId: "test-task-id",
			instanceId: "test-instance",
			abort: false,
			presentAssistantMessageLocked: false,
			presentAssistantMessageHasPendingUpdates: false,
			currentStreamingContentIndex: 0,
			assistantMessageContent: [
				{
					type: "tool_use",
					id: "tool_call_load_skill",
					name: "load_skill",
					nativeArgs: { query: "human writer" },
					params: { query: "human writer" },
					partial: false,
				},
			],
			userMessageContent: [],
			userMessageContentReady: false,
			didCompleteReadingStream: true,
			didRejectTool: false,
			didAlreadyUseTool: false,
			diffEnabled: false,
			consecutiveMistakeCount: 0,
			clineMessages: [],
			api: {
				getModel: () => ({ id: "test-model", info: {} }),
			},
			browserSession: {
				closeBrowser: vi.fn().mockResolvedValue(undefined),
			},
			recordToolUsage: vi.fn(),
			recordToolError: vi.fn(),
			toolRepetitionDetector: {
				check: vi.fn().mockReturnValue({ allowExecution: true }),
			},
			providerRef: {
				deref: () => ({
					getState: vi.fn().mockResolvedValue({
						mode: "code",
						customModes: [],
					}),
				}),
			},
			say: vi.fn().mockResolvedValue(undefined),
			askMode: "code",
		}

		mockTask.pushToolResultToUserContent = vi.fn().mockImplementation((toolResult: any) => {
			mockTask.userMessageContent.push(toolResult)
			return true
		})
	})

	it("dispatches native load_skill with the existing callback set", async () => {
		await presentAssistantMessage(mockTask)

		expect(mocks.loadSkillHandle).toHaveBeenCalledTimes(1)
		expect(mocks.loadSkillHandle).toHaveBeenCalledWith(
			mockTask,
			expect.objectContaining({
				name: "load_skill",
				nativeArgs: { query: "human writer" },
			}),
			expect.objectContaining({
				askApproval: expect.any(Function),
				handleError: expect.any(Function),
				pushToolResult: expect.any(Function),
				removeClosingTag: expect.any(Function),
				toolProtocol: "native",
			}),
		)

		expect(mockTask.userMessageContent).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: "tool_result",
					content: "loaded",
				}),
			]),
		)
	})
})
