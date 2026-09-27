import type {
	ClientMessage,
	WorkerMessage,
} from "../../../vendor/avalanche-web-abi1/src/protocol.ts";
import { serveEngine } from "../../../vendor/avalanche-web-abi1/src/worker-host.ts";
import { createPinLoader } from "./pin-loader";

interface DedicatedWorkerScope {
	readonly caches: CacheStorage;
	postMessage(message: WorkerMessage): void;
	addEventListener(type: "message", listener: (event: MessageEvent<ClientMessage>) => void): void;
}

const scope = globalThis as unknown as DedicatedWorkerScope;

serveEngine(
	{
		postMessage: (message) => {
			scope.postMessage(message);
		},
		onMessage: (listener) => {
			scope.addEventListener("message", (event) => {
				listener(event.data);
			});
		},
	},
	createPinLoader(scope.caches),
);
