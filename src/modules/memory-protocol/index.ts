/** Punto de entrada del módulo `memory-protocol`: reexporta la función que arma el protocolo, las descripciones de campos, los límites de tamaño y los tipos de cada versión. */
export { memoryProtocol, FIELD_DESCRIPTIONS, MANUAL_MAX, MCP_INSTRUCTIONS_MAX } from "./protocol";
export type { MemoryProtocol, MemoryProtocolV1, MemoryProtocolV2, MemoryProtocolV4 } from "./protocol";
