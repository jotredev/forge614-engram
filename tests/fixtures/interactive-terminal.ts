/**
 * Accesorio (fixture) de adaptación solo para procesos hijos, usado por
 * `src/interfaces/terminal/setup.test.ts`. El `readline` real sigue leyendo la entrada tal cual;
 * esto solo le hace creer que está frente a una terminal interactiva, para que las pruebas de
 * fin de entrada (EOF) e interrupción (SIGINT) se comporten de forma determinista.
 */
Object.defineProperty(process.stdin, "isTTY", { value: true });
Object.defineProperty(process.stdout, "isTTY", { value: true });
