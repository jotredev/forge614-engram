import type { Database } from "bun:sqlite";
import { schemaFeatures } from "./schema";

/** True only at schema level 11; every intelligence feature is gated on this. */
export function intelligenceEnabled(db: Database): boolean { return schemaFeatures(db)?.intelligence === true; }
