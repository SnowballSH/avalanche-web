export const HASH_MIN_MB = 16;

export const HASH_FALLBACK_CAP_MB = 256;

export const HASH_MAX_CAP_MB = 1024;

const MB_PER_GB_OF_DEVICE_MEMORY = 128;

function floorToPowerOfTwo(value: number): number {
	return 2 ** Math.floor(Math.log2(value));
}

export function hashCapMb(deviceMemoryGb?: number): number {
	if (deviceMemoryGb === undefined || !(deviceMemoryGb > 0)) return HASH_FALLBACK_CAP_MB;
	const cap = Math.min(HASH_MAX_CAP_MB, deviceMemoryGb * MB_PER_GB_OF_DEVICE_MEMORY);
	return Math.max(HASH_MIN_MB, floorToPowerOfTwo(cap));
}

export function hashChoices(deviceMemoryGb?: number): readonly number[] {
	const cap = hashCapMb(deviceMemoryGb);
	const choices: number[] = [];
	for (let size = HASH_MIN_MB; size <= cap; size *= 2) choices.push(size);
	return choices;
}
