import { LoadSkillTool } from "../LoadSkillTool"
import type { ToolCallbacks } from "../BaseTool"

const createCallbacks = () => {
	const pushToolResult = vi.fn()
	const handleError = vi.fn()
	const askApproval = vi.fn().mockResolvedValue(true)

	return {
		callbacks: {
			pushToolResult,
			handleError,
			askApproval,
			removeClosingTag: vi.fn(),
			toolProtocol: "xml" as const,
		} satisfies ToolCallbacks,
		pushToolResult,
		handleError,
		askApproval,
	}
}

const createTask = (loadSkillByQuery: ReturnType<typeof vi.fn>, getSkillsForMode = vi.fn().mockReturnValue([])) => {
	const sayAndCreateMissingParamError = vi.fn().mockResolvedValue("missing query")
	const task = {
		consecutiveMistakeCount: 0,
		didToolFailInCurrentTurn: false,
		recordToolError: vi.fn(),
		sayAndCreateMissingParamError,
		getTaskMode: vi.fn().mockResolvedValue("code"),
		providerRef: {
			deref: () => ({
				getSkillsManager: () => ({ loadSkillByQuery, getSkillsForMode }),
			}),
		},
	}

	return { task, sayAndCreateMissingParamError }
}

describe("LoadSkillTool", () => {
	it("returns loaded skill instructions for a flexible query", async () => {
		const loadSkillByQuery = vi.fn().mockResolvedValue({
			status: "loaded",
			content: {
				name: "human-like-writer",
				description: "Write natural prose",
				path: "C:/skills/human-like-writer/SKILL.md",
				source: "global",
				instructions: "# Human Writer\nWrite with a natural voice.",
			},
			alternatives: [],
		})
		const { task } = createTask(loadSkillByQuery)
		const { callbacks, pushToolResult, askApproval } = createCallbacks()

		await new LoadSkillTool().execute({ query: "human writer" }, task as never, callbacks)

		expect(askApproval).toHaveBeenCalledOnce()
		expect(loadSkillByQuery).toHaveBeenCalledWith("human writer", "code")
		expect(pushToolResult).toHaveBeenCalledWith(expect.stringContaining("human-like-writer"))
		expect(pushToolResult).toHaveBeenCalledWith(expect.stringContaining("# Human Writer"))
	})

	it("reports every ambiguous candidate and asks for clarification", async () => {
		const loadSkillByQuery = vi.fn().mockResolvedValue({
			status: "ambiguous",
			matches: [
				{ skill: { name: "human-writer", description: "Human prose", path: "a", source: "global" }, score: 44 },
				{ skill: { name: "technical-writer", description: "Technical prose", path: "b", source: "global" }, score: 43 },
			],
		})
		const { task } = createTask(loadSkillByQuery)
		const { callbacks, pushToolResult } = createCallbacks()

		await new LoadSkillTool().execute({ query: "natural writer" }, task as never, callbacks)

		const result = pushToolResult.mock.calls[0][0]
		expect(result).toContain("human-writer")
		expect(result).toContain("technical-writer")
		expect(result.toLowerCase()).toContain("clarif")
	})

	it("reports when no skill matches the query", async () => {
		const loadSkillByQuery = vi.fn().mockResolvedValue({ status: "not_found", matches: [] })
		const { task } = createTask(loadSkillByQuery)
		const { callbacks, pushToolResult } = createCallbacks()

		await new LoadSkillTool().execute({ query: "unknown skill" }, task as never, callbacks)

		expect(pushToolResult).toHaveBeenCalledWith(expect.stringContaining("No skill"))
	})

	it("rejects an empty query through the standard missing-parameter error", async () => {
		const loadSkillByQuery = vi.fn()
		const { task, sayAndCreateMissingParamError } = createTask(loadSkillByQuery)
		const { callbacks, pushToolResult } = createCallbacks()

		await new LoadSkillTool().execute({ query: "  " }, task as never, callbacks)

		expect(sayAndCreateMissingParamError).toHaveBeenCalledWith("load_skill", "query")
		expect(pushToolResult).toHaveBeenCalledWith("missing query")
		expect(loadSkillByQuery).not.toHaveBeenCalled()
		expect(task.consecutiveMistakeCount).toBe(1)
	})

	it("passes skill loading errors to the standard error handler", async () => {
		const error = new Error("ENOENT: skill file disappeared")
		const loadSkillByQuery = vi.fn().mockRejectedValue(error)
		const { task } = createTask(loadSkillByQuery)
		const { callbacks, handleError } = createCallbacks()

		await new LoadSkillTool().execute({ query: "human writer" }, task as never, callbacks)

		expect(handleError).toHaveBeenCalledWith("load skill", error)
	})


	it("answers skill inventory queries from mode metadata without loading a skill", async () => {
		const loadSkillByQuery = vi.fn()
		const getSkillsForMode = vi.fn().mockReturnValue([
			{
				name: "human-like-writer",
				description: "Writes natural prose",
				path: "C:/skills/human-like-writer/SKILL.md",
				source: "global",
			},
		])
		const { task } = createTask(loadSkillByQuery, getSkillsForMode)
		const { callbacks, pushToolResult, askApproval } = createCallbacks()

		await new LoadSkillTool().execute({ query: "skill mu ada apa aja" }, task as never, callbacks)

		expect(askApproval).not.toHaveBeenCalled()
		expect(loadSkillByQuery).not.toHaveBeenCalled()
		expect(getSkillsForMode).toHaveBeenCalledWith("code")
		expect(pushToolResult).toHaveBeenCalledWith(expect.stringContaining("human-like-writer"))
		expect(pushToolResult).toHaveBeenCalledWith(expect.stringContaining("Writes natural prose"))
	})

	it("answers English skill inventory queries without loading a skill", async () => {
		const loadSkillByQuery = vi.fn()
		const getSkillsForMode = vi.fn().mockReturnValue([])
		const { task } = createTask(loadSkillByQuery, getSkillsForMode)
		const { callbacks, pushToolResult, askApproval } = createCallbacks()

		await new LoadSkillTool().execute({ query: "list all available skills" }, task as never, callbacks)

		expect(askApproval).not.toHaveBeenCalled()
		expect(loadSkillByQuery).not.toHaveBeenCalled()
		expect(pushToolResult).toHaveBeenCalledWith("No skills are available for the current mode.")
	})
})
