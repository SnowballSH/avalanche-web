import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { notices } from "../../src/lib/licences/notices";
import { APP_SOURCE } from "../../src/lib/licences/source";

const readJson = (path: string): Record<string, unknown> =>
	JSON.parse(readFileSync(new URL(`../../${path}`, import.meta.url), "utf8"));

const installedVersion = (name: string): string =>
	String(readJson(`node_modules/${name}/package.json`).version);

const licenceMarkers: Record<string, RegExp> = {
	"GPL-3.0-only": /GNU GENERAL PUBLIC LICENSE\s+Version 3, 29 June 2007/,
	"GPL-3.0-or-later": /GNU GENERAL PUBLIC LICENSE\s+Version 3, 29 June 2007/,
	MIT: /Permission is hereby granted, free of charge/,
	"OFL-1.1": /SIL Open Font License, Version 1\.1/,
	"Apache-2.0": /Apache License\s+Version 2\.0, January 2004/,
};

describe("licence notices", () => {
	it("covers every runtime dependency at its installed version", () => {
		const dependencies = Object.keys(readJson("package.json").dependencies as object);
		for (const name of dependencies) {
			const notice = notices.find((entry) => entry.package === name);
			expect(notice, name).toBeDefined();
			expect(notice?.version).toBe(installedVersion(name));
		}
	});

	it("covers the packages the client bundle ships beyond direct dependencies", () => {
		const shipped = [
			"svelte",
			"@sveltejs/kit",
			"devalue",
			"tailwindcss",
			"class-variance-authority",
			"clsx",
			"@badrap/result",
		];
		for (const name of shipped) {
			expect(notices.find((entry) => entry.package === name)?.version, name).toBe(
				installedVersion(name),
			);
		}
	});

	it("carries each package's own licence text, matching its declared licence", () => {
		for (const notice of notices) {
			if (notice.package) {
				expect(readJson(`node_modules/${notice.package}/package.json`).license).toBe(
					notice.licence,
				);
			}
			if (notice.text === undefined) {
				expect(notice.note, notice.id).toBeTruthy();
				continue;
			}
			expect(notice.text, notice.id).toMatch(licenceMarkers[notice.licence] ?? /^$/);
		}
	});

	it("names this site's source and licence first", () => {
		const [site] = notices;
		expect(site?.source).toBe(APP_SOURCE);
		expect(site?.licence).toBe(readJson("package.json").license);
	});

	it("credits the Avalanche engine and bindings with the vendored GPL notice", () => {
		const vendored = readFileSync(
			new URL("../../vendor/avalanche-web-abi1/LICENSE", import.meta.url),
			"utf8",
		);
		const source = readFileSync(
			new URL("../../vendor/avalanche-web-abi1/SOURCE", import.meta.url),
			"utf8",
		);
		const commit = /^commit:\s*(\w+)$/m.exec(source)?.[1] ?? "";
		for (const id of ["avalanche", "avalanche-web-bindings"]) {
			expect(notices.find((entry) => entry.id === id)?.text).toBe(vendored);
		}
		expect(notices.find((entry) => entry.id === "avalanche-web-bindings")?.source).toContain(
			commit,
		);
		expect(vendored).toMatch(licenceMarkers["GPL-3.0-only"] as RegExp);
	});

	it("credits the cburnett pieces under the GPL", () => {
		const pieces = notices.find((entry) => entry.id === "cburnett");
		expect(pieces?.holder).toBe("Colin M.L. Burnett");
		expect(pieces?.licence).toBe("GPL-2.0-or-later");
	});

	it("gives every notice a unique id", () => {
		const ids = notices.map((entry) => entry.id);
		expect(new Set(ids).size).toBe(ids.length);
	});
});
