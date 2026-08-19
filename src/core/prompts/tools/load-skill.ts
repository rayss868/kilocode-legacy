export function getLoadSkillDescription(): string {
	return `## load_skill
Description: Load the instructions for a skill available to the current mode. Use this tool whenever the user names, asks about, or asks you to use a skill.
Parameters:
- query: (required) The skill name or description to look up. Matching is case-insensitive, supports partial names, treats spaces, hyphens, and underscores as equivalent separators, and does not require the same word order.

If multiple skills are similarly relevant, do not guess; ask the user for clarification.

Example:
<load_skill>
<query>writer human</query>
</load_skill>`
}
