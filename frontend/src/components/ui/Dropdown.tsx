import type { JSX } from "react";
import ArrowSvg from "../../assets/icons/arrow-down.svg?react";

interface DropdownProps {
	entries: JSX.Element | JSX.Element[];
	disabled?: boolean;
	refToApply?: React.RefObject<HTMLSelectElement | null>;
	defaultValue?: string;
	value?: string;
	onChange?: (newValue: string) => void;
	placeholder?: string;
	required?: boolean;
	error?: boolean;
	className?: string;
	id?: string;
	name?: string;
	"aria-label"?: string;
	"aria-describedby"?: string;
}

const Dropdown = ({
	entries,
	disabled = false,
	refToApply,
	defaultValue,
	value,
	onChange,
	placeholder,
	required = false,
	error = false,
	className = "",
	id,
	name,
	"aria-label": ariaLabel,
	"aria-describedby": ariaDescribedby,
}: DropdownProps) => {
	const handleOnChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
		const newValue = e.target.value;
		if (onChange) {
			onChange(newValue);
		}
	};

	const selectClasses = [
		"appearance-none",
		"w-full",
		"h-full",
		"px-2.5",
		"bg-base",
		"text-text-primary",
		"text-sm",
		"lg:text-base",
		"border-0",
		"outline-none",
		"focus:ring-0",
		"pr-8",
		"rounded",
		disabled && "cursor-not-allowed opacity-60",
		error && "text-error-text",
		"[&>option]:text-text-primary",
		"[&>option]:bg-base",
		className,
	]
		.filter(Boolean)
		.join(" ");

	const wrapperClasses = [
		"relative",
		"w-full",
		"h-[34px]",
		"border",
		error ? "border-error" : "border-border",
		"rounded",
		"bg-base",
		"overflow-hidden",
		disabled && "opacity-60",
		"transition-colors",
		!disabled && !error && "hover:border-border-strong",
		!disabled && !error && "focus-within:border-primary",
	]
		.filter(Boolean)
		.join(" ");

	const arrowClasses = [
		"absolute",
		"top-1/2",
		"-translate-y-1/2",
		"right-2",
		"pointer-events-none",
		"text-text-secondary",
		"transition-opacity",
		disabled && "opacity-40",
	]
		.filter(Boolean)
		.join(" ");

	const needsPlaceholder = placeholder && !defaultValue && !value;

	return (
		<div className={wrapperClasses}>
			<select
				className={selectClasses}
				{...(value !== undefined ? { value } : { defaultValue })}
				disabled={disabled}
				ref={refToApply}
				onChange={handleOnChange}
				required={required}
				id={id}
				name={name}
				aria-label={ariaLabel}
				aria-describedby={ariaDescribedby}
				aria-invalid={error}
			>
				{needsPlaceholder && (
					<option value="" disabled hidden>
						{placeholder}
					</option>
				)}
				{entries}
			</select>
			<ArrowSvg className={arrowClasses} />
		</div>
	);
};

export default Dropdown;
