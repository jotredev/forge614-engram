/**
 * Detector, solo para pruebas, de regresiones en la carga perezosa (lazy loading): lanza un
 * error si algo en el proceso carga el SDK de MCP o zod (su único usuario es `src/interfaces/mcp/*`,
 * que `commands.ts` importa de forma perezosa solo para el comando "mcp"). Se usa vía --preload,
 * así que si una invocación de la CLI vuelve a agregar por accidente una importación anticipada
 * de `../mcp/server`, falla de forma ruidosa en vez de pagar en silencio el análisis (parsing) del
 * SDK y el paquete de localización de zod, de 64 archivos, en cada comando.
 */
import { appendFileSync } from "node:fs";

Bun.plugin({
  name: "fail-on-mcp-import",
  setup(build) {
    build.onLoad({ filter: /node_modules\/(zod|@modelcontextprotocol)\// }, (args) => {
      // main.ts oculta a propósito el texto interno del error en stderr, así que este golpe se
      // registra en un canal aparte que la prueba puede leer directamente, en vez de analizar la
      // salida de la CLI.
      const marker = process.env.FORGE614_MCP_IMPORT_MARKER;
      if (marker) appendFileSync(marker, args.path + "\n");
      throw new Error(`FORBIDDEN_LOAD: ${args.path} was loaded by a command that must not need the MCP SDK or zod.`);
    });
  },
});
