/**
 * Test-only detector for lazy-loading regressions: throws if anything in the process
 * loads the MCP SDK or zod (its only consumer is src/interfaces/mcp/*, imported lazily
 * from commands.ts only for the "mcp" command). Used via --preload so a CLI invocation
 * that unexpectedly re-adds an eager import of ../mcp/server fails loudly instead of
 * silently paying for parsing the SDK and zod's 64-file locale barrel on every command.
 */
import { appendFileSync } from "node:fs";

Bun.plugin({
  name: "fail-on-mcp-import",
  setup(build) {
    build.onLoad({ filter: /node_modules\/(zod|@modelcontextprotocol)\// }, (args) => {
      // main.ts intentionally redacts internal error text from stderr, so record the hit
      // on a side channel the test can check directly instead of parsing CLI output.
      const marker = process.env.FORGE614_MCP_IMPORT_MARKER;
      if (marker) appendFileSync(marker, args.path + "\n");
      throw new Error(`FORBIDDEN_LOAD: ${args.path} was loaded by a command that must not need the MCP SDK or zod.`);
    });
  },
});
