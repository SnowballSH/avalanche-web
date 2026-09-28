import appLicence from "../../../LICENSE?raw";
import badrapResultLicence from "../../../node_modules/@badrap/result/LICENSE?raw";
import { version as badrapResultVersion } from "../../../node_modules/@badrap/result/package.json";
import interLicence from "../../../node_modules/@fontsource-variable/inter/LICENSE?raw";
import { version as interVersion } from "../../../node_modules/@fontsource-variable/inter/package.json";
import jetbrainsMonoLicence from "../../../node_modules/@fontsource-variable/jetbrains-mono/LICENSE?raw";
import { version as jetbrainsMonoVersion } from "../../../node_modules/@fontsource-variable/jetbrains-mono/package.json";
import chessgroundLicence from "../../../node_modules/@lichess-org/chessground/LICENSE?raw";
import { version as chessgroundVersion } from "../../../node_modules/@lichess-org/chessground/package.json";
import kitLicence from "../../../node_modules/@sveltejs/kit/LICENSE?raw";
import { version as kitVersion } from "../../../node_modules/@sveltejs/kit/package.json";
import chessopsLicence from "../../../node_modules/chessops/LICENSE.txt?raw";
import { version as chessopsVersion } from "../../../node_modules/chessops/package.json";
import cvaLicence from "../../../node_modules/class-variance-authority/LICENSE?raw";
import { version as cvaVersion } from "../../../node_modules/class-variance-authority/package.json";
import clsxLicence from "../../../node_modules/clsx/license?raw";
import { version as clsxVersion } from "../../../node_modules/clsx/package.json";
import devalueLicence from "../../../node_modules/devalue/LICENSE?raw";
import { version as devalueVersion } from "../../../node_modules/devalue/package.json";
import foundationuiLicence from "../../../node_modules/foundationui/LICENSE?raw";
import { version as foundationuiVersion } from "../../../node_modules/foundationui/package.json";
import svelteLicence from "../../../node_modules/svelte/LICENSE.md?raw";
import { version as svelteVersion } from "../../../node_modules/svelte/package.json";
import tailwindLicence from "../../../node_modules/tailwindcss/LICENSE?raw";
import { version as tailwindVersion } from "../../../node_modules/tailwindcss/package.json";
import avalancheLicence from "../../../vendor/avalanche-web-abi1/LICENSE?raw";
import avalancheSource from "../../../vendor/avalanche-web-abi1/SOURCE?raw";
import { APP_SOURCE } from "./source";

export interface Notice {
	readonly id: string;
	readonly name: string;
	readonly package?: string;
	readonly version?: string;
	readonly role: string;
	readonly licence: string;
	readonly holder: string;
	readonly source: string;
	readonly text?: string;
	readonly note?: string;
}

const vendoredCommit = (source: string): string => {
	const commit = /^commit:\s*([0-9a-f]{40})$/m.exec(source)?.[1];
	if (!commit) throw new Error("vendor/avalanche-web-abi1/SOURCE names no commit");
	return commit;
};

const bindingsCommit = vendoredCommit(avalancheSource);

export const notices: readonly Notice[] = [
	{
		id: "avalanche-web",
		name: "Avalanche Web",
		role: "This site",
		licence: "GPL-3.0-only",
		holder: "SnowballSH",
		source: APP_SOURCE,
		text: appLicence,
	},
	{
		id: "avalanche",
		name: "Avalanche",
		role: "The chess engine, compiled to WebAssembly, with its embedded Nezha NNUE network",
		licence: "MIT",
		holder: "Yinuo Huang",
		source: "https://github.com/SnowballSH/Avalanche",
		text: avalancheLicence,
		note: "The network is trained by Avalanche's author on the engine's own self-play games and ships inside the engine under the engine's licence.",
	},
	{
		id: "avalanche-web-bindings",
		name: "Avalanche web bindings",
		version: bindingsCommit.slice(0, 7),
		role: "The engine's browser bindings, vendored from the Avalanche repository",
		licence: "MIT",
		holder: "Yinuo Huang",
		source: `https://github.com/SnowballSH/Avalanche/tree/${bindingsCommit}/web`,
		text: avalancheLicence,
	},
	{
		id: "chessground",
		package: "@lichess-org/chessground",
		name: "chessground",
		version: chessgroundVersion,
		role: "The board",
		licence: "GPL-3.0-or-later",
		holder: "Lichess Team",
		source: "https://github.com/lichess-org/chessground",
		text: chessgroundLicence,
	},
	{
		id: "chessops",
		package: "chessops",
		name: "chessops",
		version: chessopsVersion,
		role: "Chess rules, FEN and PGN",
		licence: "GPL-3.0-or-later",
		holder: "Niklas Fiekas",
		source: "https://github.com/niklasf/chessops",
		text: chessopsLicence,
	},
	{
		id: "cburnett",
		name: "cburnett pieces",
		role: "The piece set, as embedded in chessground",
		licence: "GPL-2.0-or-later",
		holder: "Colin M.L. Burnett",
		source: "https://commons.wikimedia.org/wiki/Category:SVG_chess_pieces",
		note: "Offered on Wikimedia Commons under the GPL 2 or later, GFDL 1.2 or later, CC BY-SA 3.0 and BSD 3-clause licences at the user's option. This site uses the set under the GPL, version 3, whose text is above under Avalanche Web.",
	},
	{
		id: "inter",
		package: "@fontsource-variable/inter",
		name: "Inter",
		version: interVersion,
		role: "The interface font, via Fontsource",
		licence: "OFL-1.1",
		holder: "The Inter Project Authors",
		source: "https://github.com/rsms/inter",
		text: interLicence,
	},
	{
		id: "jetbrains-mono",
		package: "@fontsource-variable/jetbrains-mono",
		name: "JetBrains Mono",
		version: jetbrainsMonoVersion,
		role: "The monospace font, via Fontsource",
		licence: "OFL-1.1",
		holder: "The JetBrains Mono Project Authors",
		source: "https://github.com/JetBrains/JetBrainsMono",
		text: jetbrainsMonoLicence,
	},
	{
		id: "foundationui",
		package: "foundationui",
		name: "Foundation UI",
		version: foundationuiVersion,
		role: "Design tokens and components",
		licence: "MIT",
		holder: "SnowballSH",
		source: "https://github.com/SnowballSH/foundationui",
		text: foundationuiLicence,
	},
	{
		id: "svelte",
		package: "svelte",
		name: "Svelte",
		version: svelteVersion,
		role: "The component runtime",
		licence: "MIT",
		holder: "Svelte Contributors",
		source: "https://github.com/sveltejs/svelte",
		text: svelteLicence,
	},
	{
		id: "sveltekit",
		package: "@sveltejs/kit",
		name: "SvelteKit",
		version: kitVersion,
		role: "The client router",
		licence: "MIT",
		holder: "SvelteKit contributors",
		source: "https://github.com/sveltejs/kit",
		text: kitLicence,
	},
	{
		id: "devalue",
		package: "devalue",
		name: "devalue",
		version: devalueVersion,
		role: "Serialisation inside SvelteKit",
		licence: "MIT",
		holder: "devalue contributors",
		source: "https://github.com/sveltejs/devalue",
		text: devalueLicence,
	},
	{
		id: "tailwindcss",
		package: "tailwindcss",
		name: "Tailwind CSS",
		version: tailwindVersion,
		role: "The generated stylesheet",
		licence: "MIT",
		holder: "Tailwind Labs, Inc.",
		source: "https://github.com/tailwindlabs/tailwindcss",
		text: tailwindLicence,
	},
	{
		id: "class-variance-authority",
		package: "class-variance-authority",
		name: "class-variance-authority",
		version: cvaVersion,
		role: "Component class recipes inside Foundation UI",
		licence: "Apache-2.0",
		holder: "Joe Bell",
		source: "https://github.com/joe-bell/cva",
		text: cvaLicence,
	},
	{
		id: "clsx",
		package: "clsx",
		name: "clsx",
		version: clsxVersion,
		role: "Class-name joining",
		licence: "MIT",
		holder: "Luke Edwards",
		source: "https://github.com/lukeed/clsx",
		text: clsxLicence,
	},
	{
		id: "badrap-result",
		package: "@badrap/result",
		name: "@badrap/result",
		version: badrapResultVersion,
		role: "Result type inside chessops",
		licence: "MIT",
		holder: "Badrap Oy",
		source: "https://github.com/badrap/result",
		text: badrapResultLicence,
	},
];
