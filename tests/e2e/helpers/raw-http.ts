import { request as httpRequest } from "node:http";

export interface RawResponse {
	readonly status: number;
	readonly rawHeaders: readonly string[];
	readonly body: Buffer;
}

export function rawRequest(
	url: string,
	options: { readonly method?: "GET" | "HEAD"; readonly headers?: Record<string, string> } = {},
): Promise<RawResponse> {
	return new Promise((resolve, reject) => {
		const request = httpRequest(
			url,
			{ method: options.method ?? "GET", headers: options.headers ?? {} },
			(response) => {
				const chunks: Buffer[] = [];
				response.on("data", (chunk: Buffer) => chunks.push(chunk));
				response.on("end", () =>
					resolve({
						status: response.statusCode ?? 0,
						rawHeaders: response.rawHeaders,
						body: Buffer.concat(chunks),
					}),
				);
				response.on("error", reject);
			},
		);
		request.on("error", reject);
		request.end();
	});
}

export function headerValues(response: RawResponse, name: string): string[] {
	const values: string[] = [];
	for (let index = 0; index + 1 < response.rawHeaders.length; index += 2) {
		if (response.rawHeaders[index]?.toLowerCase() === name.toLowerCase()) {
			values.push(response.rawHeaders[index + 1] ?? "");
		}
	}
	return values;
}
