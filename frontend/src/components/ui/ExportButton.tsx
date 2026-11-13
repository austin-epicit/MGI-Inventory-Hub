import { useState } from "react";
import { Download } from "lucide-react";
import { HEADER_BTN_SECONDARY } from "./headerActions";
import { apiDownload, errorMessage } from "../../lib/api";
import { downloadBlob, exportFilename } from "../../lib/csv";
import { useToast } from "../../hooks/useToast";

interface ExportButtonProps {
	/** Server-side export URL, fetched with the session cookie so a refusal can be shown. */
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
	const toast = useToast();
	const [pending, setPending] = useState(false);

	const exportFromServer = async () => {
		if (!href || pending) return;
		setPending(true);
		try {
			const res = await apiDownload(href);
			downloadBlob(
				exportFilename(res.headers.get("Content-Disposition"), href),
				await res.blob()
			);
		} catch (err) {
			toast.error(errorMessage(err));
		} finally {
			setPending(false);
		}
	};

	return (
		<button
			type="button"
			disabled={disabled || pending}
			onClick={href ? () => void exportFromServer() : onExport}
			className={HEADER_BTN_SECONDARY}
		>
			<Download size={14} aria-hidden="true" />
			{pending ? "Exporting…" : label}
		</button>
	);
}
