import type { Page } from "@playwright/test";

declare global {
	interface Window {
		cspViolations: string[];
	}
}

const CSP_CONSOLE = /content security policy|refused to/i;

export interface CspWatch {
	violations(): Promise<string[]>;
}

export async function watchCsp(page: Page): Promise<CspWatch> {
	const consoleProblems: string[] = [];
	page.on("console", (message) => {
		if (CSP_CONSOLE.test(message.text())) consoleProblems.push(message.text());
	});
	await page.addInitScript(() => {
		window.cspViolations = [];
		document.addEventListener("securitypolicyviolation", (event) => {
			window.cspViolations.push(`${event.violatedDirective} ${event.blockedURI}`);
		});
	});
	return {
		async violations() {
			const events = await page.evaluate(() => window.cspViolations);
			return [...events, ...consoleProblems];
		},
	};
}
