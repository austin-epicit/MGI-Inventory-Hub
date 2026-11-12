import type { RequestHandler } from "express";
import { httpError } from "./responses.js";

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// Cookie auth plus same-origin deploy: a browser always sends Origin (or Referer) on unsafe
// requests, so a foreign host is a cross-site request. Header-less clients are not browsers.
export const requireSameOrigin = (publicBaseUrl: string): RequestHandler => {
	const allowedHost = new URL(publicBaseUrl).host;
	return (req, _res, next) => {
		if (!UNSAFE.has(req.method)) return next();
		const source = req.get("origin") ?? req.get("referer");
		if (!source) return next();
		let host: string | null;
		try {
			host = new URL(source).host;
		} catch {
			host = null;
		}
		if (host !== allowedHost) {
			return next(httpError(403, "BAD_ORIGIN", "Cross-origin request rejected"));
		}
		next();
	};
};
