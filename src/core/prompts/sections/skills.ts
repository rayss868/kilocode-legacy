import type { SkillsManager } from "../../../services/skills/SkillsManager"

type SkillsManagerLike = Pick<SkillsManager, "getSkillsForMode"> & {
	waitUntilReady?: () => Promise<void>
}

function escapeXml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/\"/g, "&quot;")
		.replace(/'/g, "&apos;")
}

/**
 * Generate the skills section for the system prompt.
 * Only includes skills relevant to the current mode.
 * Format matches the modes section style.
 *
 * @param skillsManager - The SkillsManager instance
 * @param currentMode - The current mode slug (e.g., 'code', 'architect')
 */
export async function getSkillsSection(
	skillsManager: SkillsManagerLike | undefined,
	currentMode: string | undefined,
): Promise<string> {
	if (!skillsManager || !currentMode) return ""

	await skillsManager.waitUntilReady?.()

	// Get skills filtered by current mode (with override resolution)
	const skills = skillsManager.getSkillsForMode(currentMode)
	if (skills.length === 0) return ""

	const skillsXml = skills
		.map((skill) => {
			const name = escapeXml(skill.name)
			const description = escapeXml(skill.description)
			// Per the Agent Skills integration guidance for filesystem-based agents,
			// location should be an absolute path to the SKILL.md file.
			const location = escapeXml(skill.path)
			return `  <skill>\n    <name>${name}</name>\n    <description>${description}</description>\n    <location>${location}</location>\n  </skill>`
		})
		.join("\n")

	return `====

AVAILABLE SKILLS

<available_skills>
${skillsXml}
</available_skills>

<mandatory_skill_check>
REQUIRED PRECONDITION

Before producing ANY user-facing response, you MUST perform a skill applicability check.

Step 1: Skill Evaluation
- Evaluate the user's request against ALL available skill <description> entries in <available_skills>.
- Determine whether at least one skill clearly and unambiguously applies.

Step 2: Branching Decision

<if_skill_inventory_requested>
- If the user asks what skills are available, asks you to list or describe the available skills, or asks what skills you have, answer directly from the current <available_skills> metadata.
- Do NOT call 'load_skill' merely to list available skills.
- Do NOT inspect the filesystem, use directory listing tools, or run commands to rediscover the skill list.
</if_skill_inventory_requested>

<if_skill_applies>
- If the user explicitly asks whether a skill exists by name, or asks you to use, inspect, check, or follow a skill, you MUST call the 'load_skill' tool first.
- Pass the user's original wording as the query; do not invent a filesystem path.
- 'load_skill' supports partial names, case-insensitive matching, separator-insensitive matching for spaces, hyphens, and underscores, and reversed word order.
- If 'load_skill' returns multiple similarly relevant candidates, ask the user for clarification instead of choosing silently.
- Select EXACTLY ONE skill only after the lookup is unambiguous.
- Follow the loaded SKILL.md instructions precisely before continuing.
- Do NOT respond outside the skill-defined flow.
</if_skill_applies>

<if_no_skill_applies>
- Proceed with a normal response.
- Do NOT load any SKILL.md files.
- Unrelated requests must not call 'load_skill'.
</if_no_skill_applies>

CONSTRAINTS:
- Do NOT load every SKILL.md up front.
- Load SKILL.md ONLY through 'load_skill' after a skill is selected.
- Do NOT skip this check.
- FAILURE to perform this check is an error.
</mandatory_skill_check>

<context_notes>
- The skill list is already filtered for the current mode: "${currentMode}".
- Mode-specific skills may come from skills-${currentMode}/ with project-level overrides taking precedence over global skills.
</context_notes>
` // kilocode_change: the <internal_verification> block was removed because models echoed <skill_check_completed> into visible output
}
