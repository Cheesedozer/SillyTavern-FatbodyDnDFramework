/**
 * ESM resolve hook: redirect SillyTavern core imports to a local stub so the
 * extension's modules can be imported under `node --test` (ST core is only
 * available in the browser runtime). Registered by test/_register.js.
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const STUB = pathToFileURL(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '_st-stub.js')
).href;

export async function resolve(specifier, context, nextResolve) {
    // The extension imports ST core as `../../../../script.js` (relative to its
    // install dir). Any specifier resolving to a bare `/script.js` is ST core.
    if (specifier.endsWith('/script.js')) {
        return { url: STUB, shortCircuit: true };
    }
    return nextResolve(specifier, context);
}
