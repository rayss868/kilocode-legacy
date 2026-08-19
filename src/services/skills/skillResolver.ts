import type { SkillMetadata } from "../../shared/skills"

export type SkillMatchStatus = "matched" | "ambiguous" | "not_found"

export type RankedSkillMatch = {
	skill: SkillMetadata
	score: number
}

export type SkillMatchResult =
	| { status: "matched"; match: RankedSkillMatch; alternatives: RankedSkillMatch[] }
	| { status: "ambiguous"; matches: RankedSkillMatch[] }
	| { status: "not_found"; matches: RankedSkillMatch[] }

const MINIMUM_MATCH_SCORE = 20
const CLEAR_WINNER_MARGIN = 10
const IMPLICIT_MINIMUM_MATCH_SCORE = 45
const IMPLICIT_CLEAR_WINNER_MARGIN = 15

export type SkillApplicabilityResult = SkillMatchResult

export function normalizeSkillQuery(value: string): string[] {
	return value
		.toLocaleLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim()
		.split(/\s+/)
		.filter(Boolean)
}

function countTokenOverlap(queryTokens: string[], candidateTokens: string[]): number {
	return queryTokens.filter((queryToken) => candidateTokens.some((candidateToken) => candidateToken.includes(queryToken))).length
}

function scoreSkill(queryTokens: string[], skill: SkillMetadata): number {
	if (queryTokens.length === 0) return 0

	const nameTokens = normalizeSkillQuery(skill.name)
	const descriptionTokens = normalizeSkillQuery(skill.description)
	const normalizedQuery = queryTokens.join(" ")
	const normalizedName = nameTokens.join(" ")

	if (normalizedQuery === normalizedName) return 100

	const nameOverlap = countTokenOverlap(queryTokens, nameTokens)
	if (nameOverlap === queryTokens.length) return 80

	const descriptionOverlap = countTokenOverlap(queryTokens, descriptionTokens)
	const nameScore = (nameOverlap / queryTokens.length) * 60
	const descriptionScore = (descriptionOverlap / queryTokens.length) * 30

	return Math.max(nameScore, descriptionScore)
}

function scoreApplicability(queryTokens: string[], skill: SkillMetadata): number {
	if (queryTokens.length === 0) return 0

	const nameTokens = normalizeSkillQuery(skill.name)
	const descriptionTokens = normalizeSkillQuery(skill.description)
	const nameOverlap = countTokenOverlap(queryTokens, nameTokens)
	const descriptionOverlap = countTokenOverlap(queryTokens, descriptionTokens)

	return Math.max(
		Math.min(nameOverlap * 40, 80),
		Math.min(descriptionOverlap * 25, 60),
	)
}

function resolveSkillMatch(
	query: string,
	skills: SkillMetadata[],
	minimumScore: number,
	winnerMargin: number,
	score = scoreSkill,
): SkillMatchResult {
	const queryTokens = normalizeSkillQuery(query)
	if (queryTokens.length === 0) return { status: "not_found", matches: [] }

	const rankedMatches = skills
		.map((skill) => ({ skill, score: score(queryTokens, skill) }))
		.filter(({ score }) => score >= minimumScore)
		.sort((left, right) => right.score - left.score || left.skill.name.localeCompare(right.skill.name))

	if (rankedMatches.length === 0) return { status: "not_found", matches: [] }

	const [bestMatch, secondMatch] = rankedMatches
	if (secondMatch && bestMatch.score - secondMatch.score < winnerMargin) {
		return { status: "ambiguous", matches: rankedMatches }
	}

	return {
		status: "matched",
		match: bestMatch,
		alternatives: rankedMatches.slice(1),
	}
}

export function resolveSkillQuery(query: string, skills: SkillMetadata[]): SkillMatchResult {
	return resolveSkillMatch(query, skills, MINIMUM_MATCH_SCORE, CLEAR_WINNER_MARGIN)
}

export function resolveSkillApplicability(
	query: string,
	skills: SkillMetadata[],
): SkillApplicabilityResult {
	return resolveSkillMatch(
		query,
		skills,
		IMPLICIT_MINIMUM_MATCH_SCORE,
		IMPLICIT_CLEAR_WINNER_MARGIN,
		scoreApplicability,
	)
}
