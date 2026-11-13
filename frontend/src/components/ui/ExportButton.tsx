import { Download } from "lucide-react";
import { HEADER_BTN_SECONDARY } from "./headerActions";

interface ExportButtonProps {
	/** Server-side export: a plain download link, the session cookie rides along. */
	href?: string;
	/** Client-side export: runs when clicked. */
	onExport?: () => void;
	disabled?: boolean;
	label?: string;
}

export default function ExportButton({
	href,
	onExport,
	disabled = false,
	label = "Export CSV",
}: ExportButtonProps) {
	const content = (
		<>
			<Download size={14} aria-hidden="true" />
			{label}
		</>
	);
	if (href && !disabled)
		return (
			<a href={href} download className={HEADER_BTN_SECONDARY}>
				{content}
			</a>
		);
	return (
		<button
			type="button"
			disabled={disabled}
			onClick={onExport}
			className={HEADER_BTN_SECONDARY}
		>
			{content}
		</button>
	);
}
