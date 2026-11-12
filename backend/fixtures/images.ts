import sharp from "sharp";

// One flat tile per category: background colour plus a crude pictogram. No text, so the output does
// not depend on which fonts the host has installed.
const TILES: Record<string, { bg: string; fg: string; shapes: string }> = {
	Servers: {
		bg: "#1e3a5f",
		fg: "#93c5fd",
		shapes: [0, 1, 2]
			.map(
				(i) =>
					`<rect x="36" y="${44 + i * 52}" width="184" height="40" rx="4"/>`
			)
			.join(""),
	},
	Storage: {
		bg: "#14532d",
		fg: "#86efac",
		shapes: `<ellipse cx="128" cy="72" rx="64" ry="20"/><rect x="64" y="72" width="128" height="100"/><ellipse cx="128" cy="172" rx="64" ry="20"/>`,
	},
	Networking: {
		bg: "#4c1d95",
		fg: "#c4b5fd",
		shapes: [0, 1, 2, 3, 4, 5]
			.map(
				(i) =>
					`<rect x="${40 + i * 30}" y="104" width="22" height="48" rx="2"/>`
			)
			.join(""),
	},
	Components: {
		bg: "#7c2d12",
		fg: "#fdba74",
		shapes: `<rect x="76" y="76" width="104" height="104" rx="8"/>${[0, 1, 2, 3].map((i) => `<rect x="${88 + i * 24}" y="52" width="8" height="20"/><rect x="${88 + i * 24}" y="184" width="8" height="20"/>`).join("")}`,
	},
};

const cache = new Map<string, Promise<Buffer>>();

export function categoryImage(category: string): Promise<Buffer> {
	const tile = TILES[category];
	if (!tile) return Promise.reject(new Error(`no placeholder tile for category ${category}`));
	let png = cache.get(category);
	if (!png) {
		const svg =
			`<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">` +
			`<rect width="256" height="256" fill="${tile.bg}"/><g fill="${tile.fg}">${tile.shapes}</g></svg>`;
		png = sharp(Buffer.from(svg)).png().toBuffer();
		cache.set(category, png);
	}
	return png;
}

// Smallest well-formed one-page PDF; stands in for a datasheet attachment.
export function placeholderPdf(): Buffer {
	const objs = [
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>",
	];
	let out = "%PDF-1.4\n";
	const offsets: number[] = [];
	objs.forEach((o, i) => {
		offsets.push(out.length);
		out += `${i + 1} 0 obj\n${o}\nendobj\n`;
	});
	const xref = out.length;
	out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
	for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
	out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
	return Buffer.from(out, "latin1");
}

// Bytes for a dataset attachment ID; null when the ID is unknown. Shared by the fixture source and
// the fake Cin7 server so both serve identical files.
export async function attachmentBytes(
	kinds: Record<string, string>,
	id: string
): Promise<{ bytes: Buffer; contentType: string } | null> {
	const kind = kinds[id];
	if (!kind) return null;
	if (kind === "pdf") return { bytes: placeholderPdf(), contentType: "application/pdf" };
	return { bytes: await categoryImage(kind), contentType: "image/png" };
}
