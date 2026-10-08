/**
 * Ejecuta los tres comandos CLI de la prueba PostgreSQL desde Node, fuera del proceso bun:test.
 * Recibe únicamente rutas y el id de proyecto; la configuración de la base permanece en el
 * FORGE614_HOME temporal. Devuelve las salidas como JSON sin imprimirlas en el log de CI.
 */
import { execFile } from "node:child_process";

const [bunExe, cliFile, forgeHome, projectId] = process.argv.slice(2);
if (!bunExe || !cliFile || !forgeHome || !projectId) {
  console.error("[diag-cli] Faltan argumentos para ejecutar la CLI de prueba.");
  process.exit(1);
}

const env = { ...process.env, FORGE614_HOME: forgeHome };

function run(command, args = []) {
  console.error(`[diag-cli] iniciando ${command}...`);
  return new Promise((resolve, reject) => {
    execFile(bunExe, [cliFile, command, ...args], { env, timeout: 20_000, maxBuffer: 1_000_000 }, (error, stdout, stderr) => {
      if (error && (error.killed || typeof error.code !== "number")) {
        reject(new Error(`La CLI ${command} no terminó limpiamente.`));
        return;
      }
      const exitCode = error?.code ?? 0;
      console.error(`[diag-cli] ${command} terminó con código ${exitCode}.`);
      resolve({ exitCode, stdout, stderr });
    });
  });
}

try {
  const search = await run("search", ["--project-id", projectId, "--query", "persistent"]);
  const save = await run("save", ["--project-id", projectId, "--title", "Later", "--content", "offline writes"]);
  const sync = await run("sync");
  process.stdout.write(JSON.stringify({ search, save, sync }));
} catch (error) {
  console.error(`[diag-cli] ${error instanceof Error ? error.message : "Fallo desconocido."}`);
  process.exitCode = 1;
}
