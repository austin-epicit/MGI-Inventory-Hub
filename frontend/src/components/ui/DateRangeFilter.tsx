import { useState, useRef, useEffect } from "react";
import { Calendar, ChevronDown, Check, X } from "lucide-react";
import { DayPicker } from "react-day-picker";
import { useSearchParams } from "react-router-dom";
import { format } from "date-fns";
import "react-day-picker/dist/style.css";
import { formatDate } from "../../lib/format";
import {
	type DateRangeOption,
	type DateRangeValue,
	formatTriggerLabel,
	parseDateRangeFromParams,
	serializeDateRange,
} from "../../util/dateRangeUtils";

/**
 * Which half of the presets to offer. Defaults to "past" so existing filters
 * keep their original menu without opting out of the future options.
 */
type PresetDirection = "past" | "future" | "both";

interface DateRangeFilterUrlProps {
	paramKey: string;
	presets?: DateRangeOption[];
	direction?: PresetDirection;
	label?: string;
}

interface DateRangeFilterControlledProps {
	value: DateRangeValue;
	onChange: (value: DateRangeValue) => void;
	presets?: DateRangeOption[];
	direction?: PresetDirection;
	label?: string;
}

type DateRangeFilterProps = DateRangeFilterUrlProps | DateRangeFilterControlledProps;

/** Options with no `group` are direction-neutral and always shown. */
const PRESET_OPTIONS: { value: DateRangeOption; label: string; group?: "past" | "future" }[] = [
	{ value: "all", label: "All" },
	{ value: "today", label: "Today" },
	{ value: "last_7_days", label: "Last 7 days", group: "past" },
	{ value: "last_30_days", label: "Last 30 days", group: "past" },
	{ value: "this_month", label: "This month", group: "past" },
	{ value: "tomorrow", label: "Tomorrow", group: "future" },
	{ value: "next_7_days", label: "Next 7 days", group: "future" },
	{ value: "next_30_days", label: "Next 30 days", group: "future" },
	{ value: "next_month", label: "Next month", group: "future" },
	{ value: "custom", label: "Custom range" },
];

export default function DateRangeFilter(props: DateRangeFilterProps) {
	if ("paramKey" in props) {
		return <UrlDateRangeFilter {...props} />;
	}
	return <DateRangeDropdown {...props} />;
}

function UrlDateRangeFilter({
	paramKey,
	presets,
	direction,
	label = "Date",
}: DateRangeFilterUrlProps) {
	const [searchParams, setSearchParams] = useSearchParams();
	const value = parseDateRangeFromParams(searchParams, paramKey);

	const handleChange = (newValue: DateRangeValue) => {
		setSearchParams((prev) => serializeDateRange(newValue, paramKey, prev));
	};

	return (
		<DateRangeDropdown
			value={value}
			onChange={handleChange}
			presets={presets}
			direction={direction}
			label={label}
		/>
	);
}

function DateRangeDropdown({
	value,
	onChange,
	presets,
	direction = "past",
	label = "Date",
}: DateRangeFilterControlledProps) {
	// An explicit `presets` list wins; otherwise fall back to the direction groups.
	const presetOptions = presets
		? PRESET_OPTIONS.filter((o) => presets.includes(o.value))
		: PRESET_OPTIONS.filter(
				(o) => !o.group || direction === "both" || o.group === direction
			);
	const [open, setOpen] = useState(false);
	const [openAbove, setOpenAbove] = useState(false);
	const [editingField, setEditingField] = useState<"start" | "end" | null>(null);
	const [calendarPos, setCalendarPos] = useState<{
		top?: number;
		bottom?: number;
		left?: number;
		right?: number;
	} | null>(null);

	const containerRef = useRef<HTMLDivElement>(null);
	const calendarRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const startBoxRef = useRef<HTMLButtonElement>(null);
	const endBoxRef = useRef<HTMLButtonElement>(null);

	const [tempOption, setTempOption] = useState<DateRangeOption>("all");
	const [tempStart, setTempStart] = useState<Date | undefined>(undefined);
	const [tempEnd, setTempEnd] = useState<Date | undefined>(undefined);

	const isActive = value.option !== "all";

	useEffect(() => {
		if (!open) return;
		const onDown = (e: MouseEvent) => {
			const inContainer = containerRef.current?.contains(e.target as Node);
			const inCalendar = calendarRef.current?.contains(e.target as Node);
			if (!inContainer && !inCalendar) {
				setOpen(false);
				setEditingField(null);
				setCalendarPos(null);
			}
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				if (editingField !== null) {
					setEditingField(null);
					setCalendarPos(null);
				} else {
					setOpen(false);
				}
			}
		};
		document.addEventListener("mousedown", onDown);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("mousedown", onDown);
			document.removeEventListener("keydown", onKey);
		};
	}, [open, editingField]);

	const handleOpen = () => {
		if (!open) {
			const today = new Date();
			setTempOption(value.option);
			setTempStart(value.startDate ?? today);
			setTempEnd(value.endDate ?? today);
			setEditingField(null);
			setCalendarPos(null);

			if (triggerRef.current) {
				const rect = triggerRef.current.getBoundingClientRect();
				setOpenAbove(rect.bottom + 280 > window.innerHeight - 16);
			}
		}
		setOpen((o) => !o);
	};

	const handlePresetClick = (option: DateRangeOption) => {
		if (option === "custom") {
			setTempOption("custom");
		} else {
			onChange({ option });
			setOpen(false);
			setEditingField(null);
			setCalendarPos(null);
		}
	};

	const handleFieldClick = (field: "start" | "end") => {
		setEditingField((prev) => (prev === field ? null : field));
		const ref = field === "start" ? startBoxRef : endBoxRef;
		if (ref.current) {
			const rect = ref.current.getBoundingClientRect();
			const CALENDAR_HEIGHT = 240;
			const openAbove = window.innerHeight - rect.bottom - 4 < CALENDAR_HEIGHT;
			const pos =
				field === "start"
					? openAbove
						? {
								bottom:
									window.innerHeight -
									rect.top +
									4,
								left: rect.left,
							}
						: { top: rect.bottom + 4, left: rect.left }
					: openAbove
						? {
								bottom:
									window.innerHeight -
									rect.top +
									4,
								right:
									window.innerWidth -
									rect.right,
							}
						: {
								top: rect.bottom + 4,
								right:
									window.innerWidth -
									rect.right,
							};
			setCalendarPos(editingField === field ? null : pos);
		}
	};

	const handleCalendarSelect = (date: Date | undefined) => {
		if (editingField === "start") {
			setTempStart(date);
		} else {
			setTempEnd(date);
		}
		setEditingField(null);
		setCalendarPos(null);
	};

	const handleApply = () => {
		if (!tempStart || !tempEnd) return;
		const start = tempStart <= tempEnd ? tempStart : tempEnd;
		const end = tempStart <= tempEnd ? tempEnd : tempStart;
		onChange({ option: "custom", startDate: start, endDate: end });
		setOpen(false);
		setEditingField(null);
		setCalendarPos(null);
	};

	const isOptionHighlighted = (option: DateRangeOption): boolean => {
		if (option === "custom") return tempOption === "custom";
		return value.option === option && tempOption !== "custom";
	};

	const calendarSelected = editingField === "start" ? tempStart : tempEnd;

	return (
		<div className="relative" ref={containerRef}>
			<style>{DAY_PICKER_DARK_CSS}</style>
			<button
				ref={triggerRef}
				type="button"
				onClick={handleOpen}
				aria-expanded={open}
				aria-haspopup="listbox"
				className={`flex items-center gap-1.5 h-9 px-3 rounded-md border text-sm transition-colors cursor-pointer whitespace-nowrap ${
					isActive
						? "bg-primary-bg border-primary text-primary-text pr-7"
						: "bg-base border-border text-text-tertiary hover:text-text-primary"
				}`}
			>
				<Calendar size={14} className="shrink-0" />
				<span>
					{isActive
						? `${label}: ${formatTriggerLabel(value)}`
						: `${label}`}
				</span>
				{!isActive && <ChevronDown size={14} className="shrink-0" />}
			</button>
			{isActive && (
				<button
					type="button"
					onClick={(e) => {
						e.stopPropagation();
						onChange({ option: "all" });
					}}
					aria-label="Clear date range"
					className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer text-primary-text/70 hover:text-primary-text"
				>
					<X size={14} className="shrink-0" />
				</button>
			)}

			{open && (
				<div
					role="listbox"
					aria-label="Date range"
					className={`absolute right-0 bg-canvas border border-border-strong rounded-lg shadow-2xl shadow-black/50 z-50 overflow-hidden ${
						openAbove ? "bottom-full mb-1.5" : "top-full mt-1.5"
					} ${tempOption === "custom" ? "w-72" : "w-44"}`}
				>
					<div className="py-1 px-1">
						{presetOptions.map((option) => (
							<button
								type="button"
								key={option.value}
								role="option"
								aria-selected={isOptionHighlighted(
									option.value
								)}
								onClick={() =>
									handlePresetClick(
										option.value
									)
								}
								className={`w-full flex items-center justify-between px-3 py-1.5 text-sm cursor-pointer rounded text-left ${
									isOptionHighlighted(
										option.value
									)
										? "bg-primary-bg text-primary-text"
										: "text-text-secondary hover:bg-surface/70"
								}`}
							>
								<span>{option.label}</span>
								{option.value !== "custom" &&
									isOptionHighlighted(
										option.value
									) && <Check size={14} />}
							</button>
						))}
					</div>

					{tempOption === "custom" && (
						<div className="border-t border-border px-3 py-3">
							<div className="grid grid-cols-2 gap-2 mb-3">
								{/* Start box */}
								<button
									type="button"
									aria-label="Start date"
									ref={startBoxRef}
									onClick={() =>
										handleFieldClick(
											"start"
										)
									}
									className={`flex items-center justify-between px-2.5 py-2 rounded-md border cursor-pointer text-left transition-colors ${
										editingField ===
										"start"
											? "border-primary bg-base"
											: "border-border bg-base hover:border-border-strong"
									}`}
								>
									<span className="min-w-0 flex-1">
										<span className="mb-0.5 block text-xs text-text-tertiary">
											Start date
										</span>
										<span className="block text-xs text-text-primary">
											{tempStart
												? formatDate(
														format(
															tempStart,
															"yyyy-MM-dd"
														)
													)
												: "—"}
										</span>
									</span>
									<Calendar
										size={13}
										className="shrink-0 ml-1.5 text-text-muted"
									/>
								</button>

								{/* End box */}
								<button
									type="button"
									aria-label="End date"
									ref={endBoxRef}
									onClick={() =>
										handleFieldClick(
											"end"
										)
									}
									className={`flex items-center justify-between px-2.5 py-2 rounded-md border cursor-pointer text-left transition-colors ${
										editingField ===
										"end"
											? "border-primary bg-base"
											: "border-border bg-base hover:border-border-strong"
									}`}
								>
									<span className="min-w-0 flex-1">
										<span className="mb-0.5 block text-xs text-text-tertiary">
											End date
										</span>
										<span className="block text-xs text-text-primary">
											{tempEnd
												? formatDate(
														format(
															tempEnd,
															"yyyy-MM-dd"
														)
													)
												: "—"}
										</span>
									</span>
									<Calendar
										size={13}
										className="shrink-0 ml-1.5 text-text-muted"
									/>
								</button>
							</div>

							<button
								type="button"
								onClick={handleApply}
								disabled={!tempStart || !tempEnd}
								className="w-full h-8 bg-primary-fill hover:bg-primary-fill-hover disabled:opacity-40 disabled:cursor-not-allowed rounded-md text-sm font-medium transition-colors text-on-primary cursor-pointer"
							>
								Apply
							</button>
						</div>
					)}
				</div>
			)}

			{/* Floating calendar popup — anchored to whichever field box was clicked */}
			{editingField !== null && calendarPos !== null && (
				<div
					ref={calendarRef}
					style={{
						position: "fixed",
						...(calendarPos.top !== undefined
							? { top: calendarPos.top }
							: {}),
						...(calendarPos.bottom !== undefined
							? { bottom: calendarPos.bottom }
							: {}),
						...(calendarPos.left !== undefined
							? { left: calendarPos.left }
							: {}),
						...(calendarPos.right !== undefined
							? { right: calendarPos.right }
							: {}),
						zIndex: 60,
					}}
					onMouseDown={(e) => e.preventDefault()}
					className="bg-canvas border border-border rounded-lg shadow-2xl shadow-black/60 p-3"
				>
					<DayPicker
						mode="single"
						selected={calendarSelected}
						onSelect={handleCalendarSelect}
						className="date-picker-dark"
					/>
				</div>
			)}
		</div>
	);
}

const DAY_PICKER_DARK_CSS = `
.date-picker-dark {
  --rdp-accent-color: var(--color-primary);
  --rdp-accent-background-color: var(--color-primary-active);
  --rdp-today-color: var(--color-primary);
  color: var(--color-text-on-surface);
  border-radius: 4px;
  pointer-events: auto !important;
  font-size: 0.75rem;
}
.date-picker-dark .rdp-month_caption {
  color: var(--color-text-on-surface);
  font-weight: 600;
  padding: 0 0 0 0.5rem;
  margin-bottom: 0.15rem;
  font-size: 0.8rem;
}
.date-picker-dark .rdp-weekday {
  color: var(--color-text-tertiary);
  font-size: 0.65rem;
  padding: 0.05rem 0.1rem;
  width: 1.8rem;
}
.date-picker-dark .rdp-day {
  width: 1.8rem;
  height: 1.8rem;
}
.date-picker-dark .rdp-day_button {
  width: 1.6rem;
  height: 1.6rem;
  padding: 0;
  border-radius: 3px;
  font-size: 0.72rem;
  line-height: 1rem;
}
.date-picker-dark .rdp-day_button:hover:not([disabled]):not(.rdp-selected .rdp-day_button) {
  background-color: var(--color-surface);
}
.date-picker-dark .rdp-selected .rdp-day_button {
  background-color: var(--color-primary);
  color: white;
  border-color: var(--color-primary);
}
.date-picker-dark .rdp-today:not(.rdp-outside) .rdp-day_button {
  color: var(--color-primary);
  font-weight: 600;
}
.date-picker-dark .rdp-day_button:disabled { opacity: 0.25; }
.date-picker-dark .rdp-button_next,
.date-picker-dark .rdp-button_previous {
  padding: 0.15rem;
  border-radius: 4px;
  color: var(--color-text-on-surface);
  width: 1.4rem;
  height: 1.4rem;
}
.date-picker-dark .rdp-button_next:hover,
.date-picker-dark .rdp-button_previous:hover { background-color: var(--color-surface); }
.date-picker-dark .rdp-months { padding: 0.25rem; }
.date-picker-dark .rdp-month { width: 100%; }
.date-picker-dark .rdp-caption_label { font-size: 0.8rem; }
`;
