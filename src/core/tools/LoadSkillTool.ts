import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import type { SkillLoadResult } from "../../services/skills/SkillsManager"
import type { ToolUse } from "../../shared/tools"

import { BaseTool, ToolCallbacks } from "./BaseTool"

interface LoadSkillParams {
	query: string
}

function isSkillInventoryQuery(query: string): boolean {
	const normalizedQuery = query
		.toLocaleLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim()

	return (
		/\b(list|show|describe)\b.*\b(skill|skills)\b/.test(normalizedQuery) ||
		/\b(available|existing)\s+skills?\b/.test(normalizedQuery) ||
		/\bwhat\s+skills?\s+(are\s+)?available\b/.test(normalizedQuery) ||
		/\bwhat\s+skills?\s+do\s+you\s+have\b/.test(normalizedQuery) ||
		/\bskill\s+(mu|kamu)\s+ada\s+apa\s+(aja|saja)\b/.test(normalizedQuery) ||
		/\bskill\s+apa\s+(aja|saja)\b/.test(normalizedQuery) ||
		/\bskills?\s+apa\s+yang\s+tersedia\b/.test(normalizedQuery)
	)
}

function formatSkillInventoryResult(skills: Array<{ name: string; description: string }>): string {
	if (skills.length === 0) return "No skills are available for the current mode."

	return [
		"Available skills:",
		...skills.map((skill) => `- ${skill.name}: ${skill.description}`),
	].join("\n")
}

function formatSkillLoadResult(result: SkillLoadResult): string {
	if (result.status === "loaded") {
		return [
			`Skill loaded: ${result.content.name}`,
			`Description: ${result.content.description}`,
			`Instructions:\n${result.content.instructions}`,
		].join("\n\n")
	}

	if (result.status === "ambiguous") {
		const candidates = result.matches.map(({ skill, score }) => `- ${skill.name} (${score}): ${skill.description}`).join("\n")
		return `Multiple skills match this query. Please ask the user for clarification before loading one:\n${candidates}`
	}

	if (result.matches.length === 0) {
		return "No skill matched the query."
	}

	const candidates = result.matches.map(({ skill, score }) => `- ${skill.name} (${score}): ${skill.description}`).join("\n")
	return `No skill matched the query. Closest candidates were:\n${candidates}`
}

export class LoadSkillTool extends BaseTool<"load_skill"> {
	readonly name = "load_skill" as const

	parseLegacy(params: Partial<Record<string, string>>): LoadSkillParams {
		return {
			query: params.query || "",
		}
	}

	async execute(params: LoadSkillParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { handleError, pushToolResult, askApproval } = callbacks
		const query = params.query.trim()

		try {
			if (!query) {
				task.consecutiveMistakeCount++
				task.recordToolError("load_skill")
				task.didToolFailInCurrentTurn = true
				pushToolResult(await task.sayAndCreateMissingParamError("load_skill", "query"))
				return
			}

			const provider = task.providerRef.deref()
			const skillsManager = provider?.getSkillsManager()
			if (!skillsManager) {
				throw new Error("Skills manager not available")
			}

			const currentMode = await task.getTaskMode()
			if (isSkillInventoryQuery(query)) {
				await skillsManager.waitUntilReady?.()
				pushToolResult(formatSkillInventoryResult(skillsManager.getSkillsForMode(currentMode)))
				return
			}

			const didApprove = await askApproval("tool", JSON.stringify({ tool: "loadSkill", query }))
			if (!didApprove) {
				pushToolResult(formatResponse.toolDenied())
				return
			}

			task.consecutiveMistakeCount = 0
			const result = await skillsManager.loadSkillByQuery(query, currentMode)
			pushToolResult(formatSkillLoadResult(result))
		} catch (error) {
			await handleError("load skill", error as Error)
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"load_skill">): Promise<void> {
		await task.ask(
			"tool",
			JSON.stringify({ tool: "loadSkill", query: block.params.query }),
			block.partial,
		)
	}
}

export const loadSkillTool = new LoadSkillTool()
