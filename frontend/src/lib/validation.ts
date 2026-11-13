// Stricter than the browser's type="email" check, which lets a@b through; the server's
// z.email() rejects it.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const EMAIL_ERROR = "Enter a valid email address.";

export function isValidEmail(s: string): boolean {
	return EMAIL_RE.test(s.trim());
}
