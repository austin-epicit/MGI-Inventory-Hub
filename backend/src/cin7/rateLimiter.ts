const WINDOW_MS = 60_000;

export type RateLimiter = { take(): Promise<void> };

// Sliding window: at most `perMinute` takes in any 60 s span. Callers queue in arrival order.
export function createRateLimiter(opts: {
	perMinute: number;
	clock: () => number;
	sleep: (ms: number) => Promise<void>;
}): RateLimiter {
	const stamps: number[] = [];
	let tail: Promise<void> = Promise.resolve();

	async function acquire(): Promise<void> {
		for (;;) {
			const now = opts.clock();
			while (stamps.length > 0 && stamps[0]! <= now - WINDOW_MS) stamps.shift();
			if (stamps.length < opts.perMinute) {
				stamps.push(now);
				return;
			}
			await opts.sleep(Math.max(1, stamps[0]! + WINDOW_MS - now));
		}
	}

	return {
		take() {
			const mine = tail.then(acquire);
			tail = mine.catch(() => {});
			return mine;
		},
	};
}
