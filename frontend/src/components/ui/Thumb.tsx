import { useState } from "react";
import { ImageOff } from "lucide-react";

// Fixed-size frame so rows keep their height whether or not a picture exists.
export default function Thumb({ url, name }: { url: string | null; name: string }) {
	// Keyed by url so a new picture gets a fresh try after an earlier 404.
	const [failedUrl, setFailedUrl] = useState<string | null>(null);
	const showImage = url !== null && url !== failedUrl;
	return (
		<div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded bg-surface">
			{!showImage && (
				<ImageOff
					size={16}
					className="text-text-faint"
					data-testid="thumb-placeholder"
				/>
			)}
			{showImage && (
				<img
					src={url}
					alt={name}
					loading="lazy"
					width={40}
					height={40}
					onError={() => setFailedUrl(url)}
					className="h-10 w-10 object-contain"
				/>
			)}
		</div>
	);
}
