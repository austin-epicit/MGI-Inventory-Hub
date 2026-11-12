// mulberry32: tiny, fast and stable across Node versions, which is all the demo data needs.
export class Rng {
	private state: number;
	constructor(seed: number) {
		this.state = seed >>> 0;
	}

	next(): number {
		this.state = (this.state + 0x6d2b79f5) >>> 0;
		let t = this.state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	}

	/** Integer in [min, max], inclusive. */
	int(min: number, max: number): number {
		return min + Math.floor(this.next() * (max - min + 1));
	}

	float(min: number, max: number): number {
		return min + this.next() * (max - min);
	}

	chance(p: number): boolean {
		return this.next() < p;
	}

	pick<T>(items: readonly T[]): T {
		return items[Math.floor(this.next() * items.length)];
	}

	/** Picks by relative weight; `weights[i]` belongs to `items[i]`. */
	weighted<T>(items: readonly T[], weights: readonly number[]): T {
		let total = 0;
		for (const w of weights) total += w;
		let r = this.next() * total;
		for (let i = 0; i < items.length; i++) {
			r -= weights[i];
			if (r < 0) return items[i];
		}
		return items[items.length - 1];
	}

	/** Version-4-shaped GUID, deterministic per seed. */
	guid(): string {
		const hex = (n: number) =>
			Array.from({ length: n }, () =>
				Math.floor(this.next() * 16).toString(16)
			).join("");
		return `${hex(8)}-${hex(4)}-4${hex(3)}-${"89ab"[Math.floor(this.next() * 4)]}${hex(3)}-${hex(12)}`;
	}
}
