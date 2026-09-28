import { expect, type Locator } from "@playwright/test";

export interface ClipReport {
	readonly width: number;
	readonly height: number;
	readonly clippedBy: readonly string[];
}

export const clipReport = (locator: Locator): Promise<ClipReport> =>
	locator.evaluate((element) => {
		const box = element.getBoundingClientRect();
		const contains = (outer: DOMRect) =>
			box.left >= outer.left - 0.5 &&
			box.right <= outer.right + 0.5 &&
			box.top >= outer.top - 0.5 &&
			box.bottom <= outer.bottom + 0.5;
		const clippedBy: string[] = [];
		for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
			const { overflowX, overflowY } = getComputedStyle(ancestor);
			const clips = [overflowX, overflowY].some((value) => value !== "visible");
			if (clips && !contains(ancestor.getBoundingClientRect())) {
				clippedBy.push(`${ancestor.tagName.toLowerCase()}.${ancestor.className}`);
			}
		}
		const viewport = new DOMRect(
			0,
			0,
			document.documentElement.clientWidth,
			document.documentElement.scrollHeight,
		);
		if (!contains(viewport)) clippedBy.push("viewport");
		return { width: box.width, height: box.height, clippedBy };
	});

export const expectUnclipped = async (locator: Locator, text: string | RegExp) => {
	await expect(locator).toHaveText(text);
	const report = await clipReport(locator);
	expect(report.width).toBeGreaterThan(0);
	expect(report.height).toBeGreaterThan(0);
	expect(report.clippedBy).toEqual([]);
};

export const expectDisjoint = async (first: Locator, second: Locator) => {
	const [a, b] = await Promise.all([first.boundingBox(), second.boundingBox()]);
	if (!a || !b) throw new Error("an element has no box");
	const overlaps =
		a.x < b.x + b.width - 0.5 &&
		b.x < a.x + a.width - 0.5 &&
		a.y < b.y + b.height - 0.5 &&
		b.y < a.y + a.height - 0.5;
	expect(overlaps).toBe(false);
};
