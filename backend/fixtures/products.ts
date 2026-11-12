import { API_HOST, FILES_HOST, GRADES, MODELS } from "./catalog.js";
import { r4, slug, type GenContext, type Slot } from "./context.js";

export type Products = {
	slots: Slot[];
	attachmentKinds: Record<string, string>;
	// Weighted pick of distinct products that may trade in month `m`.
	pickSlots: (n: number, m: number) => Slot[];
};

export function buildProducts({ rng, months, monthLabel }: GenContext): Products {
	const opts = { months };
	const slots: Slot[] = [];
	const attachmentKinds: Record<string, string> = {};
	for (const m of MODELS) {
		for (const g of GRADES) {
			const sku = `${slug(m.brand).slice(0, 3)}-${slug(m.model)}-${g.code}`;
			const id = rng.guid();
			slots.push({
				category: m.category,
				status: "Active",
				weight: Math.pow(rng.float(0.05, 1), 2.2) + 0.02,
				points: [],
				rec: {
					ID: id,
					SKU: sku,
					Name: `${m.brand} ${m.model} - ${g.label}`,
					Category: m.category,
					Brand: m.brand,
					Type: "Stock",
					CostingMethod: "FIFO",
					DropShipMode: "No Drop Ship",
					DefaultLocation: "Main Warehouse",
					UOM: "Item",
					Barcode: String(rng.int(100_000_000_000, 999_999_999_999)),
					MinimumBeforeReorder: 0,
					ReorderQuantity: 0,
					PriceTier1: 0,
					PriceTier2: 0,
					PriceTier3: 0,
					PriceTier4: 0,
					PriceTier5: 0,
					PriceTier6: 0,
					PriceTier7: 0,
					PriceTier8: 0,
					PriceTier9: 0,
					PriceTier10: 0,
					PriceTiers: {},
					AverageCost: 0,
					ShortDescription: "",
					Description: "",
					Status: "Active",
					Sellable: true,
					LastModifiedOn: null,
					Suppliers: [],
					Attachments: [],
				},
			});
		}
	}
	// One shuffle hands out the special roles, so each edge case lands on distinct products.
	const order = slots.map((_, i) => i);
	for (let i = order.length - 1; i > 0; i--) {
		const j = rng.int(0, i);
		[order[i], order[j]] = [order[j], order[i]];
	}
	let cursor = 0;
	const take = (n: number) => order.slice(cursor, (cursor += n)).map((i) => slots[i]);
	const setupRequired = take(12);
	const deprecated = take(4);
	const noImage = take(6);
	const threeImages = take(9);
	const pdfOnes = take(4);
	const retailOnly = take(6);
	const twoImages = take(20);
	for (const s of setupRequired) s.status = "Setup required";
	for (const s of deprecated) s.status = "Deprecated";

	const addAttachment = (s: Slot, kind: "image" | "pdf", n: number) => {
		const id = rng.guid();
		const pdf = kind === "pdf";
		attachmentKinds[id] = pdf ? "pdf" : s.category;
		s.rec.Attachments!.push({
			ID: id,
			ContentType: pdf ? "application/pdf" : "image/png",
			FileName: pdf ? `${s.rec.SKU}-datasheet.pdf` : `${s.rec.SKU}-${n}.png`,
			DownloadUrl: `https://${pdf ? FILES_HOST : API_HOST}/attachments/${id}`,
		});
	};
	for (const s of slots) {
		if (s.status === "Setup required" || noImage.includes(s)) continue;
		const count = threeImages.includes(s) ? 3 : twoImages.includes(s) ? 2 : 1;
		for (let n = 1; n <= count; n++) addAttachment(s, "image", n);
		if (pdfOnes.includes(s)) addAttachment(s, "pdf", 0);
	}

	// Cost random walk (+-3%/month, rare steps) and list prices that only re-price on a real move.
	const priceStep = (x: number) =>
		Math.max(1, x >= 100 ? Math.round(x / 5) * 5 : Math.round(x));
	for (const [idx, s] of slots.entries()) {
		const tmpl = MODELS[Math.floor(idx / GRADES.length)];
		const grade = GRADES[idx % GRADES.length];
		if (s.status === "Setup required") {
			s.points = Array.from({ length: opts.months }, (_, m) => ({
				month: monthLabel(m),
				averageCost: 0,
				tierPrices: Array(10).fill(0),
			}));
			continue;
		}
		let cost = tmpl.cost * grade.costFactor * rng.float(0.9, 1.1);
		const markup = rng.float(1.22, 1.6);
		let retail = 0;
		for (let m = 0; m < opts.months; m++) {
			if (m > 0) {
				cost *= 1 + rng.float(-0.03, 0.03);
				if (rng.chance(0.04))
					cost *= rng.chance(0.5)
						? 1 + rng.float(0.1, 0.2)
						: 1 - rng.float(0.08, 0.15);
				cost = Math.max(1, cost);
			}
			const target = cost * markup;
			if (m === 0 || Math.abs(target / retail - 1) > 0.06)
				retail = priceStep(target);
			const only = retailOnly.includes(s);
			const tiers = Array(10).fill(0);
			tiers[0] = retail;
			tiers[1] = only ? 0 : priceStep(retail * 0.9);
			tiers[2] = only ? 0 : priceStep(retail * 0.82);
			s.points.push({
				month: monthLabel(m),
				averageCost: r4(cost),
				tierPrices: tiers,
			});
		}
	}

	const weightFor = (s: Slot, m: number) =>
		s.status === "Setup required" || (s.status === "Deprecated" && m >= opts.months - 6)
			? 0
			: s.weight;
	const eligible = Array.from({ length: opts.months }, (_, m) =>
		slots.map((s) => ({ s, w: weightFor(s, m) })).filter((x) => x.w > 0)
	);
	const pickSlots = (n: number, m: number) => {
		const pool = eligible[m];
		const out: Slot[] = [];
		for (let tries = 0; out.length < n && tries < 20; tries++) {
			const s = rng.weighted(
				pool.map((x) => x.s),
				pool.map((x) => x.w)
			);
			if (!out.includes(s)) out.push(s);
		}
		return out;
	};

	return { slots, attachmentKinds, pickSlots };
}
