import type OpenAI from "openai"

const LOAD_SKILL_DESCRIPTION = `Load the instructions for a skill available to the current mode.

Use this tool whenever the user names, asks about, or asks you to use a skill. The query is flexible: it is case-insensitive, supports partial names, treats spaces, hyphens, and underscores as equivalent separators, and does not require the words to be in the same order. If multiple skills are similarly relevant, do not guess; ask the user to clarify which skill they mean.

Parameters:
- query: (required) The skill name or description to look up.`

export default {
	type: "function",
	function: {
		name: "load_skill",
		description: LOAD_SKILL_DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				query: {
					type: "string",
					description: "Skill name or description to resolve and load",
				},
			},
			required: ["query"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
