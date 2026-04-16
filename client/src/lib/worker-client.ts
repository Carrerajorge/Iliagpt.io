import { wrap, Remote } from 'comlink';

let worker: Worker | null = null;
let api: Remote<any> | null = null; // Use 'any' or import the type if we extract it

export function getFormulaEngineWorker() {
    if (!worker) {
        worker = new Worker(new URL('../workers/formula-engine.worker.ts', import.meta.url), {
            type: 'module'
        });
        api = wrap(worker);
    }
    return api;
}
