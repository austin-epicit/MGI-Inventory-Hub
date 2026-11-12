// Shared look for the public auth screens; theme tokens only, so light and dark both follow.
export const authPage = "flex min-h-svh items-center justify-center bg-canvas text-text-primary";
export const authCard = "bg-base shadow-md rounded-lg p-8 w-80 space-y-4 border border-border-card";
export const authInput =
	"w-full border border-border-input bg-surface-inset rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-faint focus:outline-none focus:ring-1 focus:ring-primary transition-colors";
export const authButton =
	"w-full bg-primary text-on-primary py-2 rounded hover:bg-primary-hover transition-colors hover:cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed";
export const authTitle = "text-xl font-semibold text-center text-text-primary";
export const authError = "text-error-text text-sm text-center";
export const authHint = "text-sm text-text-muted text-center";
export const authLink = "text-text-link hover:underline";
