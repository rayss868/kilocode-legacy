// kilocode_change - new file
import { DEFAULT_LOOP_DETECTION_ENABLED, DEFAULT_LOOP_DETECTION_MAX_INTERVENTIONS, DEFAULT_LOOP_DETECTION_MAX_REPEATS } from "@roo-code/types"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"

import { Slider } from "@/components/ui"

interface LoopDetectionControlProps {
	enabled?: boolean
	maxRepeats?: number
	maxInterventions?: number
	onChange: (field: "loopDetectionEnabled" | "loopDetectionMaxRepeats" | "loopDetectionMaxInterventions", value: any) => void
}

export const LoopDetectionControl: React.FC<LoopDetectionControlProps> = ({
	enabled = DEFAULT_LOOP_DETECTION_ENABLED,
	maxRepeats = DEFAULT_LOOP_DETECTION_MAX_REPEATS,
	maxInterventions = DEFAULT_LOOP_DETECTION_MAX_INTERVENTIONS,
	onChange,
}) => {
	const { t } = useAppTranslation()

	return (
		<div className="flex flex-col gap-2">
			<div>
				<VSCodeCheckbox checked={enabled} onChange={(e: any) => onChange("loopDetectionEnabled", e.target.checked)}>
					<span className="font-medium">{t("settings:providers.loopDetection.label")}</span>
				</VSCodeCheckbox>
				<div className="text-vscode-descriptionForeground text-sm">{t("settings:providers.loopDetection.description")}</div>
			</div>
			<div className={`flex flex-col gap-1 ${enabled ? "" : "opacity-50 pointer-events-none"}`}>
				<label className="block font-medium mb-1">
					{t("settings:providers.loopDetection.maxRepeatsLabel", { value: maxRepeats })}
				</label>
				<div className="flex items-center gap-2">
					<Slider
						value={[Math.max(2, maxRepeats)]}
						min={2}
						max={10}
						step={1}
						onValueChange={(newValue) => onChange("loopDetectionMaxRepeats", Math.max(2, newValue[0]))}
					/>
					<span className="w-10">{Math.max(2, maxRepeats)}</span>
				</div>
				<div className="text-sm text-vscode-descriptionForeground">
					{t("settings:providers.loopDetection.maxRepeatsDescription")}
				</div>
				<label className="block font-medium mb-1 mt-2">
					{t("settings:providers.loopDetection.maxInterventionsLabel", { value: maxInterventions })}
				</label>
				<div className="flex items-center gap-2">
					<Slider
						value={[Math.max(1, maxInterventions)]}
						min={1}
						max={5}
						step={1}
						onValueChange={(newValue) => onChange("loopDetectionMaxInterventions", Math.max(1, newValue[0]))}
					/>
					<span className="w-10">{Math.max(1, maxInterventions)}</span>
				</div>
				<div className="text-sm text-vscode-descriptionForeground">
					{t("settings:providers.loopDetection.maxInterventionsDescription")}
				</div>
			</div>
		</div>
	)
}
