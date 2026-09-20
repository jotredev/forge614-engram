const postgresUrl = /\bpostgres(?:ql)?:\/\/[^\s"'`]+/giu;

function redactPostgresUrls(message: string): string {
  return message.replace(postgresUrl, "[URL de PostgreSQL oculta]");
}

export class MemoryError extends Error {
  constructor(public readonly code: string, message: string) {
    super(redactPostgresUrls(message));
    this.name = "MemoryError";
  }
}
