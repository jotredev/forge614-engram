/**
 * Publica el texto de instrucciones que el servidor MCP (Model Context Protocol, el protocolo que usan
 * los asistentes de IA para hablar con herramientas externas como esta memoria) entrega al conectarse.
 * Ese texto es una sola fuente, generada por el manual de versión 4 en `memory-protocol`; este archivo
 * no lo edita, solo lo reexpone. Lo usa `src/interfaces/mcp/server.ts` al construir el servidor MCP.
 */
import { memoryProtocol } from "../memory-protocol";

// Las instrucciones del servidor MCP son la salida "mcpInstructions" del manual de versión 4:
// una sola fuente, nunca se edita aquí directamente.
export const MEMORY_PROTOCOL = memoryProtocol(4).mcpInstructions;
