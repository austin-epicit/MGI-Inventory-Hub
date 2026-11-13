export interface ApiResponse<T = unknown> {
	success: boolean;
	data: T | null;
	error: ErrorDetails | null;
	meta?: ResponseMeta;
}

export interface ErrorDetails {
	code: string;
	message: string;
	details?: unknown;
	field?: string | null;
}

export interface ResponseMeta {
	timestamp?: string;
	count?: number;
	hasMore?: boolean;
	total?: number;
	page?: number;
	pageSize?: number;
}

export const createSuccessResponse = <T>(
	data: T,
	meta?: Partial<ResponseMeta>
): ApiResponse<T> => ({
	success: true,
	data,
	error: null,
	meta: { timestamp: new Date().toISOString(), ...meta },
});

export const createErrorResponse = (
	code: string,
	message: string,
	details?: unknown,
	field?: string | null
): ApiResponse<null> => ({
	success: false,
	data: null,
	error: { code, message, details, field },
	meta: { timestamp: new Date().toISOString() },
});

// The global errorHandler reads `statusCode` and `code` off the thrown error, so
// `throw httpError(...)` surfaces the right status instead of a blanket 500.
export interface HttpError extends Error {
	statusCode: number;
	code: string;
	details?: unknown;
	field?: string | null;
}

export const httpError = (statusCode: number, code: string, message: string): HttpError => {
	const err = new Error(message) as HttpError;
	err.statusCode = statusCode;
	err.code = code;
	return err;
};
