export interface NavigationItem {
	readonly label: string;
	readonly href: string;
}

export const navigation: readonly NavigationItem[] = [
	{ label: "Analysis", href: "/analysis" },
	{ label: "Play", href: "/play" },
	{ label: "Engines", href: "/engines" },
];
