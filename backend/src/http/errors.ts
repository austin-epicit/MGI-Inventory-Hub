import type { ErrorRequestHandler, RequestHandler } from "express";
import { log } from "../log.js";
import { createErrorResponse } from "./responses.js";

export const notFoundHandler: RequestHandler = (req, res) => {
	res.status(404).json(
		createErrorResponse("NOT_FOUND", `Route not found: ${req.method} ${req.path}`)
	);
};

// Only errors thrown via httpError carry a code worth trusting; Node errors also have string
// `code`s (ECONNRESET) that must not leak as API codes.
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
	const status: number = err?.statusCode ?? err?.status ?? 500;
	const isHttpError = typeof err?.statusCode === "number" && typeof err?.code === "string";
	if (status >= 500) {
		log.error({ err, method: req.method, path: req.path }, "Unhandled request error");
	}

	const code = isHttpError ? err.code : status < 500 ? "BAD_REQUEST" : "SERVER_ERROR";
	const message =
		status < 500 || process.env.NODE_ENV !== "production"
			? (err?.message ?? "An unexpected error occurred")
			: "An unexpected error occurred";
	res.status(status).json(createErrorResponse(code, message));
};
