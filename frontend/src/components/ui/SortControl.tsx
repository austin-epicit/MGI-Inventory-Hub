import { useSearchParams } from "react-router-dom";
import { ArrowUp, ArrowDown } from "lucide-react";
import { DropdownFilter } from "./StatusFilter";

interface SortControlProps {
	options: { value: string; label: string }[];
	defaultDirByField?: Record<string, "asc" | "desc">;
}

export default function SortControl({ options, defaultDirByField }: SortControlProps) {
	const [params, setParams] = useSearchParams();
	const sort = params.get("sort");
	const dir = params.get("dir") === "asc" ? "asc" : "desc";

	const setField = (field: string | null) =>
		setParams((prev) => {
			const next = new URLSearchParams(prev);
			if (!field) {
				next.delete("sort");
				next.delete("dir");
			} else {
				next.set("sort", field);
				next.set("dir", defaultDirByField?.[field] ?? "asc");
			}
			return next;
		});
	const handleChange = (field: string | null) =>
		setField(field && field === sort ? null : field);

	const toggleDir = () =>
		setParams((prev) => {
			const next = new URLSearchParams(prev);
			next.set("dir", dir === "asc" ? "desc" : "asc");
			return next;
		});

	return (
		<div className="flex items-center gap-1">
			<DropdownFilter
				values={sort ? [sort] : null}
				onChange={handleChange}
				options={options}
				placeholder="Sort"
				allLabel="Default"
				exclusive
			/>
			{sort && (
				<button
					onClick={toggleDir}
					className="flex items-center justify-center h-9 w-9 rounded-md border border-border bg-base text-text-tertiary hover:text-text-primary transition-colors"
					aria-label="Toggle sort direction"
				>
					{dir === "asc" ? (
						<ArrowUp size={14} />
					) : (
						<ArrowDown size={14} />
					)}
				</button>
			)}
		</div>
	);
}
