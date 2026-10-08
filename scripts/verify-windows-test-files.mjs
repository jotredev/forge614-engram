/**
 * Ejecuta cada archivo de pruebas en un proceso Bun independiente en la CI Windows.
 * Bun 1.4.2 puede fallar en su estado nativo tras acumular conexiones PostgreSQL
 * de varios archivos en un mismo proceso. Todos los archivos siguen siendo obligatorios.
 */
import { spawn, spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";

if (process.platform !== "win32") {
  console.error("Este verificador está diseñado exclusivamente para Windows.");
  process.exit(1);
}
if (process.env.FORGE614_REQUIRE_TEST_POSTGRES !== "1" || !process.env.FORGE614_TEST_POSTGRES_BIN) {
  console.error("PostgreSQL estricto debe estar configurado antes de ejecutar las pruebas de Windows.");
  process.exit(1);
}

const roots = ["src", "tests", "scripts"];
const testFile = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const files = [];

function collect(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) collect(path);
    else if (entry.isFile() && testFile.test(entry.name)) files.push(relative(process.cwd(), path).replaceAll("\\", "/"));
  }
}

for (const root of roots) collect(root);
files.sort();
if (files.length === 0) {
  console.error("No se encontraron archivos de pruebas.");
  process.exit(1);
}
console.log(`[windows-tests] Ejecutando ${files.length} archivos, cada uno en su propio proceso Bun.`);

const totals = { pass: 0, skip: 0, fail: 0 };
let failedFiles = 0;

for (const file of files) {
  console.log(`[windows-tests] Iniciando ${file}`);
  let output = "";
  const child = spawn("bun", ["test", file], { env: process.env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  for (const [stream, destination] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
    stream.on("data", chunk => {
      const value = chunk.toString();
      output += value;
      destination.write(chunk);
    });
  }

  const outcome = await new Promise(resolve => {
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      console.error(`[windows-tests] Tiempo límite de 120s en ${file}; terminando PID ${child.pid}.`);
      if (child.pid) {
        spawnSync("taskkill", ["/F", "/T", "/PID", String(child.pid)], { stdio: "ignore", timeout: 5_000 });
        child.kill("SIGKILL");
      }
      finish({ code: null, reason: "timeout" });
    }, 120_000);
    child.once("error", error => finish({ code: null, reason: error.message }));
    child.once("close", code => finish({ code, reason: null }));
  });

  const plain = output.replace(/\x1b\[[0-9;]*m/g, "");
  const count = kind => Number(plain.match(new RegExp(`(?:^|\\n)\\s*(\\d+) ${kind}(?:\\r?\\n|$)`))?.[1] ?? 0);
  const pass = count("pass"), skip = count("skip"), fail = count("fail");
  totals.pass += pass;
  totals.skip += skip;
  totals.fail += fail;
  const valid = outcome.code === 0 && /Ran \d+ tests? across 1 file\./.test(plain);
  if (!valid) failedFiles++;
  console.log(`[windows-tests] ${file}: ${pass} pass, ${skip} skip, ${fail} fail, exit=${outcome.code ?? outcome.reason}.`);
}

console.log(`[windows-tests] TOTAL: ${totals.pass} pass, ${totals.skip} skip, ${totals.fail} fail; ${failedFiles} archivos fallidos de ${files.length}.`);
process.exitCode = failedFiles === 0 ? 0 : 1;
