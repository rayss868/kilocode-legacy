// kilocode_change - new file
/**
 * Trailing-edge throttle for posting extension state to the webview.
 *
 * Coalesces bursts of postStateToWebview() calls (e.g. a settings save firing ~30
 * setting handlers, or a checkpoint rewind/abort posting several states back-to-back)
 * into a single immediate post, while guaranteeing the FINAL call in a burst is still
 * delivered once the window elapses. Without the trailing edge, the last post carrying
 * the newest message list could be dropped, leaving the chat panel blank/stale even
 * though the history still exists.
 */
export class StatePostThrottle {
	private lastPostTime = 0
	private pendingTimer: ReturnType<typeof setTimeout> | undefined

	constructor(private readonly minIntervalMs: number) {}

	/**
	 * Invokes `post` immediately if outside the throttle window, returning its promise.
	 * Calls arriving inside the window are skipped, but schedule exactly one trailing
	 * invocation of `post` so the newest state is never lost.
	 */
	async attempt(post: () => Promise<void>): Promise<void> {
		const now = Date.now()
		if (now - this.lastPostTime >= this.minIntervalMs) {
			this.lastPostTime = now
			if (this.pendingTimer) {
				clearTimeout(this.pendingTimer)
				this.pendingTimer = undefined
			}
			await post()
			return
		}
		if (!this.pendingTimer) {
			this.pendingTimer = setTimeout(() => {
				this.pendingTimer = undefined
				void this.attempt(post)
			}, this.minIntervalMs)
		}
	}

	dispose(): void {
		if (this.pendingTimer) {
			clearTimeout(this.pendingTimer)
			this.pendingTimer = undefined
		}
	}
}