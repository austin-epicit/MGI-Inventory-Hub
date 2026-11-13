import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, ImageOff, X } from "lucide-react";
import { useDialogA11y } from "../../hooks/useDialogA11y";
import type { ProductImage } from "./api";

type LoadState = "loading" | "loaded" | "error";

// Picture with a shimmer while it loads and an icon if it fails.
function Picture({ src, alt, className }: { src: string; alt: string; className: string }) {
	const [status, setStatus] = useState<LoadState>("loading");
	return (
		<>
			{status === "loading" && (
				<div className="absolute inset-0 animate-pulse rounded-lg bg-surface" />
			)}
			{status === "error" && (
				<div className="absolute inset-0 flex items-center justify-center rounded-lg bg-surface">
					<ImageOff size={28} className="text-text-faint" />
				</div>
			)}
			<img
				ref={(node) => {
					// A cached picture can finish before React attaches onLoad.
					if (node?.complete && node.naturalWidth > 0)
						setStatus("loaded");
				}}
				src={src}
				alt={alt}
				onLoad={() => setStatus("loaded")}
				onError={() => setStatus("error")}
				className={`${className} transition-opacity duration-150 ease-out ${
					status === "loaded" ? "opacity-100" : "opacity-0"
				}`}
			/>
		</>
	);
}

const NAV_BTN =
	"flex items-center justify-center rounded-full bg-black/60 text-white transition-opacity duration-150 ease-out";

function Lightbox({
	images,
	index,
	name,
	onIndex,
	onClose,
}: {
	images: ProductImage[];
	index: number;
	name: string;
	onIndex: (i: number) => void;
	onClose: () => void;
}) {
	const a11y = useDialogA11y<HTMLDivElement>(onClose);
	const many = images.length > 1;
	const go = useCallback(
		(step: number) => onIndex((index + step + images.length) % images.length),
		[index, images.length, onIndex]
	);
	useEffect(() => {
		if (!many) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "ArrowLeft") go(-1);
			if (e.key === "ArrowRight") go(1);
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [many, go]);

	const image = images[index]!;
	return createPortal(
		<div
			{...a11y}
			aria-label={`${name} pictures`}
			className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-6 outline-none"
			onClick={onClose}
		>
			<button
				type="button"
				aria-label="Close"
				onClick={onClose}
				className={`${NAV_BTN} absolute right-4 top-4 h-9 w-9 cursor-pointer`}
			>
				<X size={18} />
			</button>
			{many && (
				<button
					type="button"
					aria-label="Previous picture"
					onClick={(e) => {
						e.stopPropagation();
						go(-1);
					}}
					className={`${NAV_BTN} absolute left-4 top-1/2 h-10 w-10 -translate-y-1/2 cursor-pointer`}
				>
					<ChevronLeft size={20} />
				</button>
			)}
			<div
				className="relative h-full max-h-[85vh] w-full max-w-5xl"
				onClick={(e) => e.stopPropagation()}
			>
				<Picture
					key={image.id}
					src={image.originalUrl}
					alt={`${name}, picture ${index + 1} of ${images.length}`}
					className="absolute inset-0 h-full w-full object-contain"
				/>
			</div>
			{many && (
				<button
					type="button"
					aria-label="Next picture"
					onClick={(e) => {
						e.stopPropagation();
						go(1);
					}}
					className={`${NAV_BTN} absolute right-4 top-1/2 h-10 w-10 -translate-y-1/2 cursor-pointer`}
				>
					<ChevronRight size={20} />
				</button>
			)}
			{many && (
				<p className="absolute bottom-4 left-1/2 -translate-x-1/2 text-sm tabular-nums text-white/80">
					{index + 1} / {images.length}
				</p>
			)}
		</div>,
		document.body
	);
}

/** Product pictures with a full-size lightbox. */
export default function ProductGallery({ images, name }: { images: ProductImage[]; name: string }) {
	const [index, setIndex] = useState(0);
	const [open, setOpen] = useState(false);
	const close = useCallback(() => setOpen(false), []);

	if (images.length === 0)
		return (
			<div
				role="img"
				aria-label={`No picture for ${name}`}
				className="flex aspect-[4/3] w-full grow items-center justify-center rounded-lg border border-border-subtle bg-surface"
			>
				<ImageOff size={32} className="text-text-faint" />
			</div>
		);

	const i = Math.min(index, images.length - 1);
	const many = images.length > 1;
	const label = `picture ${i + 1} of ${images.length}`;
	const go = (step: number) => setIndex((i + step + images.length) % images.length);

	return (
		<div className="group relative aspect-[4/3] w-full grow overflow-hidden rounded-lg border border-border-subtle bg-base">
			<button
				type="button"
				aria-label={`Open ${label}`}
				onClick={() => setOpen(true)}
				className="absolute inset-3 cursor-zoom-in"
			>
				<Picture
					key={images[i]!.id}
					src={images[i]!.mediumUrl}
					alt={`${name}, ${label}`}
					className="absolute inset-0 h-full w-full object-contain"
				/>
			</button>
			{many && (
				<>
					<button
						type="button"
						aria-label="Previous picture"
						onClick={() => go(-1)}
						className={`${NAV_BTN} absolute left-1.5 top-1/2 z-10 h-7 w-7 -translate-y-1/2 cursor-pointer opacity-0 focus-visible:opacity-100 group-hover:opacity-100`}
					>
						<ChevronLeft size={16} />
					</button>
					<button
						type="button"
						aria-label="Next picture"
						onClick={() => go(1)}
						className={`${NAV_BTN} absolute right-1.5 top-1/2 z-10 h-7 w-7 -translate-y-1/2 cursor-pointer opacity-0 focus-visible:opacity-100 group-hover:opacity-100`}
					>
						<ChevronRight size={16} />
					</button>
					<div className="absolute bottom-0 left-1/2 z-10 flex -translate-x-1/2">
						{images.map((img, n) => (
							<button
								key={img.id}
								type="button"
								aria-label={`Show picture ${n + 1}`}
								aria-current={n === i}
								onClick={() => setIndex(n)}
								className="flex h-5 w-5 cursor-pointer items-center justify-center"
							>
								<span
									className={`h-1.5 w-1.5 rounded-full transition-colors duration-150 ease-out ${
										n === i
											? "bg-text-tertiary"
											: "bg-border-strong"
									}`}
								/>
							</button>
						))}
					</div>
				</>
			)}
			{open && (
				<Lightbox
					images={images}
					index={i}
					name={name}
					onIndex={setIndex}
					onClose={close}
				/>
			)}
		</div>
	);
}
