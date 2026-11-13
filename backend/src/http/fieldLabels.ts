const LABELS: Record<string, string> = {
	email: "Email",
	password: "Password",
	setupToken: "Setup token",
	token: "Link",
	name: "Name",
	role: "Role",
	accountId: "Account ID",
	applicationKey: "Application key",
	search: "Search",
	from: "From date",
	to: "To date",
};

// camelCase -> "Sentence case" for keys the map doesn't know.
export const fieldLabel = (key: string): string => {
	const known = LABELS[key];
	if (known) return known;
	const words = key
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.replace(/[_-]+/g, " ")
		.trim()
		.toLowerCase();
	return words ? words[0].toUpperCase() + words.slice(1) : "This field";
};
