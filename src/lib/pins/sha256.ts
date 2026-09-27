import type { Sha256Hex } from "./types";

export async function sha256Hex(bytes: Uint8Array): Promise<Sha256Hex> {
	const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
