import { expect, test } from "bun:test";
import { findSecret } from "./secrets";

const join = (...parts: string[]) => parts.join("");
const SAMPLES: ReadonlyArray<readonly [string, string]> = [
  ["private-key", join("-----BEGIN ", "RSA PRIVATE KEY-----\nMIIEow")],
  ["aws-access-key-id", join("clave AK", "IAIOSFODNN7EXAMPLE en el archivo")],
  ["github-token", join("gh", "p_", "a".repeat(36))],
  ["slack-token", join("xo", "xb-", "1234567890-abcdefghij")],
  ["sk-key", join("s", "k-", "b".repeat(40))],
  ["jwt", join("ey", "JhbGciOiJIUzI1NiJ9.", "ey", "JzdWIiOiIxMjM0NTY3ODkwIn0.", "c".repeat(20))],
  ["connection-string-with-credentials", join("postgres", "://admin:", "s3cret-value", "@db.internal:5432/app")],
  ["password-assignment", join("pass", "word = ", "hunter2hunter2")],
];

test("every secret pattern is detected and only its id is returned", () => {
  for (const [id, text] of SAMPLES) expect(findSecret(text)).toBe(id);
});

const BENIGN = [
  "El paso release:publish recibe GH_TOKEN desde github.token en la plantilla del reglamento 1.0.2.",
  "Tokens totales: 8 857 497; salida 55 484; razonamiento 6 836.",
  "Instalar con https://github.com/jotredev/forge614-sentinel/releases/download/v0.1.1/install.sh",
  "sha256 10d036f02f767d54b0b7d710e96b21b249e034b480b0d83be124df5b2f97a4f5 del paquete del reglamento.",
  "La réplica usa PostgreSQL; la URL se oculta en los mensajes de error.",
  "Nunca guardar contraseñas, tokens, llaves privadas ni cadenas de conexión con credenciales.",
  "sessionId y sessionProjectId son obligatorios juntos para shared.",
  "project id 42007e73-ab93-4b4e-9e1a-a699e48674c1 y grupo e0b3e1c9-ffbb-4b6b-8a55-79fbf3e8f0b4.",
  "La clave de ejemplo de AWS se describe en prosa: AKIA seguido del resto, nunca completa.",
  "git@github.com:jotredev/forge614-ai.git es el remoto.",
  "Correr bun test --timeout 30000 y bun run typecheck antes del commit.",
  "El check versions compara package.json con el tag más alto v0.1.1.",
  "Usar requestKey estable forge614-ai/plan-a2/decisiones/2026-09-24-q1-q2.",
  "La tarea de riesgo alto usa Opus; la de riesgo bajo, Sonnet.",
  "password y token aparecen como palabras sueltas en la documentación de seguridad.",
  "http://localhost:3000/@scope/package es una ruta local de prueba.",
  "ECOSYSTEM_BOARD_FULL devuelve los títulos actuales para consolidar.",
  "El respaldo queda en engram.db.v10-pre-intelligence-20260924T180657787Z-0542aea7.bak.",
  "Precio de Opus 5.5: entrada $4, salida $20 por millón de tokens.",
  "La API key se configura como variable de entorno, nunca en la memoria.",
];

test("real domain texts are never rejected", () => {
  for (const text of BENIGN) expect(findSecret(text)).toBeNull();
});
