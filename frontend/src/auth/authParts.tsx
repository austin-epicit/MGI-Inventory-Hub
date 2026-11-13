import { useId } from "react";
import type { InputHTMLAttributes } from "react";
import { authError, authFieldError, authInput, authInputInvalid } from "./authForm";

// An auth input with its error underneath, linked by aria-describedby.
export function AuthField({
	label,
	error,
	...input
}: { label: string; error?: string } & Omit<
	InputHTMLAttributes<HTMLInputElement>,
	"aria-label" | "aria-invalid" | "aria-describedby" | "className"
>) {
	const errorId = useId();
	return (
		<div>
			<input
				{...input}
				placeholder={input.placeholder ?? label}
				aria-label={label}
				aria-invalid={error ? true : undefined}
				aria-describedby={error ? errorId : undefined}
				className={`${authInput} ${error ? authInputInvalid : ""}`}
			/>
			{error && (
				<p id={errorId} role="alert" className={authFieldError}>
					{error}
				</p>
			)}
		</div>
	);
}

// Without the status the first-admin link can't be offered, so say so instead of hiding it.
export function SetupStatusError({ onRetry }: { onRetry: () => void }) {
	return (
		<p role="alert" className={authError}>
			Can't check setup status.{" "}
			<button
				type="button"
				onClick={onRetry}
				className="underline hover:cursor-pointer"
			>
				Try again
			</button>
		</p>
	);
}
