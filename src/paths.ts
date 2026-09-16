import { homedir } from "node:os";
import { join } from "node:path";

/** Shared user storage, independent of the project or process working directory. */
export function defaultDatabasePath(): string {
  return join(homedir(), ".forge614", "engram.db");
}
