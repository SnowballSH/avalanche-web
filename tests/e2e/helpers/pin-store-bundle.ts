import { fileURLToPath } from "node:url";
import { build, type Rolldown } from "vite";

const PIN_STORE_GLOBAL = "AvalanchePinStore";

const storeModule = fileURLToPath(new URL("../../../src/lib/pins/store.ts", import.meta.url));

export async function bundlePinStore(): Promise<string> {
	const result = await build({
		configFile: false,
		logLevel: "silent",
		build: {
			write: false,
			minify: false,
			lib: { entry: storeModule, formats: ["iife"], name: PIN_STORE_GLOBAL },
		},
	});
	const [output] = (Array.isArray(result) ? result : [result]) as Rolldown.RolldownOutput[];
	const chunk = output?.output.find((file) => file.type === "chunk");
	if (!chunk) throw new Error("vite produced no PinStore bundle");
	return `${chunk.code}\nglobalThis.${PIN_STORE_GLOBAL} = ${PIN_STORE_GLOBAL};\n`;
}
