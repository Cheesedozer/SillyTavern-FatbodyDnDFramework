/**
 * Registers the ST-core resolve hook. Loaded via `node --import ./test/_register.js`.
 */
import { register } from 'node:module';
register('./_hooks.js', import.meta.url);
