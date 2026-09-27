/**
 * Punto de entrada del ejecutable de línea de comandos (`bun src/cli.ts`, registrado como el script `cli`
 * de `package.json`): delega todo el trabajo a `main` de `src/interfaces/cli/main.ts`, pasándole los
 * argumentos recibidos sin el nombre del intérprete ni del script.
 */
import { main } from "./interfaces/cli/main";
await main(process.argv.slice(2));
