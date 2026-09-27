export interface AbiImport {
	readonly module: string;
	readonly name: string;
	readonly kind: string;
}

export interface AbiExport {
	readonly name: string;
	readonly kind: string;
}

export interface ModuleAbi {
	readonly imports: readonly AbiImport[];
	readonly exports: readonly AbiExport[];
}

export type AbiSide = "import" | "export";

export type AbiChange = "missing" | "unexpected";

export interface AbiDifference {
	readonly side: AbiSide;
	readonly change: AbiChange;
	readonly name: string;
	readonly kind: string;
}

const byName = (a: { name: string }, b: { name: string }): number => a.name.localeCompare(b.name);

export function describeModuleAbi(module: WebAssembly.Module): ModuleAbi {
	return {
		imports: WebAssembly.Module.imports(module)
			.map(({ module, name, kind }) => ({ module, name, kind }))
			.sort((a, b) => `${a.module}.${a.name}`.localeCompare(`${b.module}.${b.name}`)),
		exports: WebAssembly.Module.exports(module)
			.map(({ name, kind }) => ({ name, kind }))
			.sort(byName),
	};
}

interface Member {
	readonly name: string;
	readonly kind: string;
}

const memberKey = (member: Member): string => `${member.name}\u0000${member.kind}`;

function diffMembers(
	side: AbiSide,
	recorded: readonly Member[],
	actual: readonly Member[],
): AbiDifference[] {
	const recordedKeys = new Set(recorded.map(memberKey));
	const actualKeys = new Set(actual.map(memberKey));
	const missing = recorded
		.filter((member) => !actualKeys.has(memberKey(member)))
		.map((member): AbiDifference => ({ side, change: "missing", ...member }));
	const unexpected = actual
		.filter((member) => !recordedKeys.has(memberKey(member)))
		.map((member): AbiDifference => ({ side, change: "unexpected", ...member }));
	return [...missing, ...unexpected];
}

const qualifyImports = (imports: readonly AbiImport[]): Member[] =>
	imports.map(({ module, name, kind }) => ({ name: `${module}.${name}`, kind }));

export function compareAbi(recorded: ModuleAbi, actual: ModuleAbi): readonly AbiDifference[] {
	return [
		...diffMembers("import", qualifyImports(recorded.imports), qualifyImports(actual.imports)),
		...diffMembers("export", recorded.exports, actual.exports),
	];
}

export function formatAbiDifference(difference: AbiDifference): string {
	return `${difference.change} ${difference.side}: ${difference.name} (${difference.kind})`;
}
