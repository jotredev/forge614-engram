// Child-process-only adapter fixture. Real readline still consumes the input
// stream; this supplies terminal capability for deterministic EOF/SIGINT tests.
Object.defineProperty(process.stdin, "isTTY", { value: true });
Object.defineProperty(process.stdout, "isTTY", { value: true });
