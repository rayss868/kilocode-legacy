import type { SkillMetadata } from "../../../shared/skills"

import { normalizeSkillQuery, resolveSkillApplicability, resolveSkillQuery } from "../skillResolver"

const humanWriter: SkillMetadata = {
	name: "human-like-writer",
	description: "Writes natural Indonesian and English prose",
	path: "/skills/human-like-writer/SKILL.md",
	source: "global",
}

const codeReviewer: SkillMetadata = {
	name: "code-reviewer",
	description: "Reviews source code for correctness and maintainability",
	path: "/skills/code-reviewer/SKILL.md",
	source: "global",
}

describe("normalizeSkillQuery", () => {
	it("normalizes case and common separators into tokens", () => {
		expect(normalizeSkillQuery(" Human_like-WRITER ")).toEqual(["human", "like", "writer"])
	})
})

describe("resolveSkillQuery", () => {
	it("matches an exact normalized skill name", () => {
		const result = resolveSkillQuery("human-like-writer", [humanWriter])

		expect(result.status).toBe("matched")
		if (result.status === "matched") {
			expect(result.match.skill).toBe(humanWriter)
		}
	})

	it("matches partial name tokens regardless of word order", () => {
		const result = resolveSkillQuery("writer human", [humanWriter])

		expect(result.status).toBe("matched")
		if (result.status === "matched") {
			expect(result.match.skill).toBe(humanWriter)
		}
	})

	it("matches separator and capitalization variants", () => {
		expect(resolveSkillQuery("human_writer", [humanWriter]).status).toBe("matched")
		expect(resolveSkillQuery("HUMAN WRITER", [humanWriter]).status).toBe("matched")
	})

	it("uses description overlap as supporting evidence", () => {
		const result = resolveSkillQuery("natural prose", [humanWriter, codeReviewer])

		expect(result.status).toBe("matched")
		if (result.status === "matched") {
			expect(result.match.skill).toBe(humanWriter)
		}
	})

	it("returns a deterministic winner when one candidate is clearly stronger", () => {
		const skills = [codeReviewer, humanWriter]
		const first = resolveSkillQuery("human writer", skills)
		const second = resolveSkillQuery("human writer", [...skills].reverse())

		expect(first.status).toBe("matched")
		expect(second.status).toBe("matched")
		if (first.status === "matched" && second.status === "matched") {
			expect(first.match.skill.name).toBe("human-like-writer")
			expect(second.match.skill.name).toBe("human-like-writer")
		}
	})

	it("returns ambiguous when similarly matching skills are too close", () => {
		const similarSkills: SkillMetadata[] = [
			{
				...humanWriter,
				name: "human-like-writer",
				path: "/skills/human-like-writer/SKILL.md",
			},
			{
				...humanWriter,
				name: "human-writer",
				path: "/skills/human-writer/SKILL.md",
			},
		]

		const result = resolveSkillQuery("natural writer", similarSkills)

		expect(result.status).toBe("ambiguous")
		if (result.status === "ambiguous") {
			expect(result.matches.map(({ skill }) => skill.name)).toEqual([
				"human-like-writer",
				"human-writer",
			])
		}
	})

	it("returns not_found when no candidate is relevant", () => {
		expect(resolveSkillQuery("database migration", [humanWriter, codeReviewer])).toMatchObject({
			status: "not_found",
		})
	})
})

describe("resolveSkillApplicability", () => {
	const proseWriter: SkillMetadata = {
		name: "prose-writer",
		description: "Creates polished natural prose and readable articles",
		path: "/skills/prose-writer/SKILL.md",
		source: "global",
	}

	const technicalWriter: SkillMetadata = {
		name: "technical-writer",
		description: "Creates natural prose for clear technical documentation and API references",
		path: "/skills/technical-writer/SKILL.md",
		source: "global",
	}

	it("matches a clear natural-language request to a skill description", () => {
		const result = resolveSkillApplicability(
			"Write natural prose for human readers",
			[humanWriter, codeReviewer],
		)

		expect(result).toMatchObject({
			status: "matched",
			match: { skill: { name: "human-like-writer" } },
		})
	})

	it("does not auto-select a skill for a generic request", () => {
		expect(resolveSkillApplicability("Buat tulisan yang bagus", [humanWriter])).toMatchObject({
			status: "not_found",
		})
	})

	it("returns ambiguity when strong candidates are within the implicit margin", () => {
		const result = resolveSkillApplicability(
			"natural prose articles",
			[technicalWriter, proseWriter],
		)

		expect(result.status).toBe("ambiguous")
	})

	it("returns a clear winner when the second candidate is at least 15 points behind", () => {
		const result = resolveSkillApplicability(
			"natural human-sounding prose",
			[humanWriter, codeReviewer],
		)

		expect(result).toMatchObject({
			status: "matched",
			match: { skill: { name: "human-like-writer" } },
		})
	})

	it("keeps deterministic ordering for equal-score alternatives", () => {
		const first = resolveSkillApplicability("natural prose", [humanWriter, proseWriter])
		const second = resolveSkillApplicability("natural prose", [proseWriter, humanWriter])

		expect(first).toEqual(second)
	})
})
