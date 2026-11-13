import type { ErrorRequestHandler, RequestHandler } from "express";
import { log } from "../log.js";
import { createErrorResponse } from "./responses.js";

export const notFoundHandler: RequestHandler = (req, res) => {
	log.warn({ method: req.method, path: req.path }, "Route not found");
	res.status(404).json(
		createErrorResponse("NOT_FOUND", "This action isn't available. Reload the page.")
	);
};

// Only errors thrown via httpError carry a code worth trusting; Node errors also have string
// `code`s (ECONNRESET) that must not leak as API codes.
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
	const status: number = err?.statusCode ?? err?.status ?? 500;
	const isHttpError = typeof err?.statusCode === "number" && typeof err?.code === "string";
	if (status >= 500) {
		log.error({ err, method: req.method, path: req.path }, "Unhandled request error");
		// Raw Prisma/Node text never becomes the message; developers get it in `details` outside prod.
		// httpError messages are authored by us (e.g. Cin7 unreachable), so those stay readable.
		const details = process.env.NODE_ENV !== "production" ? err?.message : undefined;
		res.status(status).json(
			createErrorResponse(
				isHttpError ? err.code : "SERVER_ERROR",
				isHttpError
					? err.message
					: "Something went wrong on our side. Try again.",
				details
			)
		);
		return;
	}

	const code = isHttpError ? err.code : "BAD_REQUEST";
	res.status(status).json(
		createErrorResponse(
			code,
			err?.message ?? "Something went wrong on our side. Try again.",
			err?.details,
			err?.field
		)
	);
};
