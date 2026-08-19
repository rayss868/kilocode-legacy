import { getSkillsSection } from "../skills"

describe("getSkillsSection", () => {
	it("should emit <available_skills> XML with name, description, and location", async () => {
		const mockSkillsManager = {
			getSkillsForMode: vi.fn().mockReturnValue([
				{
					name: "pdf-processing",
					description: "Extracts text & tables from PDFs",
					path: "/abs/path/pdf-processing/SKILL.md",
					source: "global" as const,
				},
			]),
		}

		const result = await getSkillsSection(mockSkillsManager, "code")

		expect(result).toContain("<available_skills>")
		expect(result).toContain("</available_skills>")
		expect(result).toContain("<skill>")
		expect(result).toContain("<name>pdf-processing</name>")
		// Ensure XML escaping for '&'
		expect(result).toContain("<description>Extracts text &amp; tables from PDFs</description>")
		// For filesystem-based agents, location should be the absolute path to SKILL.md
		expect(result).toContain("<location>/abs/path/pdf-processing/SKILL.md</location>")
		expect(result).toContain("load_skill")
		expect(result).toContain("explicitly asks whether a skill exists")
		expect(result).toContain("partial")
		expect(result).toContain("word order")
	})

	it("instructs the model to answer skill inventory questions from available metadata", async () => {
		const mockSkillsManager = {
			getSkillsForMode: vi.fn().mockReturnValue([
				{
					name: "human-like-writer",
					description: "Writes natural prose",
					path: "/skills/human-like-writer/SKILL.md",
					source: "global" as const,
				},
			]),
		}

		const result = await getSkillsSection(mockSkillsManager, "code")

		expect(result).toContain("list or describe the available skills")
		expect(result).toContain("<available_skills>")
		expect(result).toContain("Do NOT inspect the filesystem")
	})
	it("should wait for skill discovery before reading available skills", async () => {
		let releaseDiscovery!: () => void
		const discoveryReady = new Promise<void>((resolve) => {
			releaseDiscovery = resolve
		})
		const getSkillsForMode = vi.fn().mockReturnValue([
			{
				name: "human-like-writer",
				description: "Writes natural prose",
				path: "/skills/human-like-writer/SKILL.md",
				source: "global" as const,
			},
		])
		const mockSkillsManager = {
			waitUntilReady: vi.fn(() => discoveryReady),
			getSkillsForMode,
		}

		const sectionPromise = getSkillsSection(mockSkillsManager, "ask")
		await Promise.resolve()
		expect(getSkillsForMode).not.toHaveBeenCalled()

		releaseDiscovery()
		const result = await sectionPromise

		expect(mockSkillsManager.waitUntilReady).toHaveBeenCalledOnce()
		expect(getSkillsForMode).toHaveBeenCalledWith("ask")
		expect(result).toContain("human-like-writer")
	})

	it("should return empty string when skillsManager or currentMode is missing", async () => {
		await expect(getSkillsSection(undefined, "code")).resolves.toBe("")
		await expect(getSkillsSection({ getSkillsForMode: vi.fn() }, undefined)).resolves.toBe("")
	})
})
