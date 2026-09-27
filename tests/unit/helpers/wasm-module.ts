export interface SyntheticModuleShape {
	readonly imports: readonly string[];
	readonly exports: readonly string[];
	readonly exportMemory?: boolean;
}

const MAGIC = [0x00, 0x61, 0x73, 0x6d];
const VERSION = [0x01, 0x00, 0x00, 0x00];

const SECTION_TYPE = 1;
const SECTION_IMPORT = 2;
const SECTION_FUNCTION = 3;
const SECTION_MEMORY = 5;
const SECTION_EXPORT = 7;
const SECTION_CODE = 10;

const KIND_FUNCTION = 0x00;
const KIND_MEMORY = 0x02;

function uleb(value: number): number[] {
	const bytes: number[] = [];
	let rest = value;
	do {
		let byte = rest & 0x7f;
		rest >>>= 7;
		if (rest !== 0) byte |= 0x80;
		bytes.push(byte);
	} while (rest !== 0);
	return bytes;
}

function name(text: string): number[] {
	const encoded = [...new TextEncoder().encode(text)];
	return [...uleb(encoded.length), ...encoded];
}

function section(id: number, payload: number[]): number[] {
	return [id, ...uleb(payload.length), ...payload];
}

function vector(items: readonly number[][]): number[] {
	return [...uleb(items.length), ...items.flat()];
}

export function synthesizeWasm(shape: SyntheticModuleShape): Uint8Array<ArrayBuffer> {
	const voidType = [0x60, 0x00, 0x00];
	const importEntries = shape.imports.map((entry) => {
		const [module = "env", field = entry] = entry.includes(".") ? entry.split(".", 2) : [];
		return [...name(module), ...name(field), KIND_FUNCTION, 0];
	});
	const functionCount = shape.exports.length;
	const exportEntries = shape.exports.map((field, index) => [
		...name(field),
		KIND_FUNCTION,
		...uleb(shape.imports.length + index),
	]);
	if (shape.exportMemory ?? true) exportEntries.push([...name("memory"), KIND_MEMORY, 0]);
	const emptyBody = [0x02, 0x00, 0x0b];

	return Uint8Array.from([
		...MAGIC,
		...VERSION,
		...section(SECTION_TYPE, vector([voidType])),
		...section(SECTION_IMPORT, vector(importEntries)),
		...section(SECTION_FUNCTION, vector(Array.from({ length: functionCount }, () => [0]))),
		...section(SECTION_MEMORY, vector([[0x00, 0x01]])),
		...section(SECTION_EXPORT, vector(exportEntries)),
		...section(SECTION_CODE, vector(Array.from({ length: functionCount }, () => emptyBody))),
	]);
}
