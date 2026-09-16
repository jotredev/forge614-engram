# 04. Guía de Integración con el SDK de TypeScript

> **Etapa:** Etapa 1 — Memoria Local  
> **Estado:** Vigente y Activo  
> **Traducción hermana:** [04 (EN). TypeScript SDK Guide (MemoryStore)](../en/04-typescript-sdk.md)

Esta guía explica cómo importar y utilizar la clase `MemoryStore` en tus propias aplicaciones y scripts de TypeScript dentro de este repositorio.

> [!NOTE]
> **Dirigido a programadores:** `MemoryStore` es una herramienta para programadores que desean embeber memoria en sus aplicaciones. El usuario final de la terminal no necesita escribir código TypeScript para usar `forge614-engram`.

---

## 1. Importación y Opciones de Conexión

Forge614 Engram exporta su interfaz principal directamente desde `src/index.ts`:

```typescript
import {
  MemoryStore,
  MemoryError,
  defaultDatabasePath,
  memoryTypes,
  type SaveInput,
  type Memory,
  type MemoryVersion,
  type SearchResult,
} from "./src/index";
```

### Inicialización de la Base de Datos

```typescript
// 1. Conexión estándar compartida: usa automáticamente ~/.forge614/engram.db
const store = new MemoryStore();

// 2. Ruta personalizada: para bases de datos aisladas o pruebas
const customStore = new MemoryStore("./carpeta-aislada/pruebas.sqlite");

// 3. Almacenamiento en memoria volátil: desaparece por completo al cerrar el proceso
const memoryOnlyStore = new MemoryStore(":memory:");
```

> [!IMPORTANT]
> **Cierre limpio de recursos:** La conexión con SQLite debe cerrarse al terminar de operar para liberar descriptores de archivo y sincronizar los registros del diario WAL. Utiliza siempre la estructura `try { ... } finally { store.close(); }`.

---

## 2. Ejemplo Completo y Funcional

Guarda este script en la raíz del repositorio (por ejemplo en `ejemplo.ts`) y ejecútalo con `bun run ejemplo.ts`:

```typescript
import { MemoryStore, MemoryError, defaultDatabasePath } from "./src/index";

// Abre la conexión predeterminada del usuario (~/.forge614/engram.db)
const store = new MemoryStore();
console.log("Ruta de almacenamiento utilizada:", defaultDatabasePath());

try {
  // 1. Guardar un recuerdo inicial con clave temática
  const saved = store.save({
    project: "backend-api",
    title: "Motor de Base de Datos",
    content: "Utilizamos PostgreSQL para producción y SQLite para pruebas locales",
    type: "decision",
    topicKey: "architecture/storage",
    requestKey: "req-001",
  });

  console.log("Recuerdo guardado con ID:", saved.id);
  console.log("Versión actual:", saved.version);

  // 2. Buscar recuerdos activos relacionados con SQLite
  const searchResults = store.search("backend-api", "SQLite", 5);
  for (const item of searchResults) {
    console.log(`[Coincidencia] ${item.memory.title}: ${item.memory.content}`);
    console.log(`Modo: ${item.explanation.mode}, Puntaje: ${item.explanation.orderScore}`);
  }

  // 3. Recuperar la ficha completa del recuerdo
  const current = store.get("backend-api", saved.id);
  if (current) {
    console.log("Estado de la memoria:", current.state); // "active"
  }

  // 4. Actualizar a la versión 2 (requiere expectedVersion)
  const updated = store.save({
    project: "backend-api",
    title: "Motor de Base de Datos",
    content: "Utilizamos PostgreSQL 16 en producción y SQLite en desarrollo local",
    type: "decision",
    topicKey: "architecture/storage",
    expectedVersion: 1, // Coincide con la versión 1 existente
    requestKey: "req-002",
  });

  console.log("Nueva versión guardada:", updated.version); // 2

  // 5. Consultar la auditoría completa de versiones
  const historyList = store.history("backend-api", saved.id);
  console.log(`Total de versiones históricas: ${historyList.length}`);
  for (const snap of historyList) {
    console.log(` -> Versión ${snap.version} (${snap.updatedAt}): ${snap.content}`);
  }

  // 6. Archivar el recuerdo (lo retira de búsquedas activas)
  store.archive("backend-api", saved.id);
  console.log("Búsqueda tras archivar:", store.search("backend-api", "SQLite").length); // 0

  // 7. Restaurar el recuerdo (restituye la visibilidad en búsquedas)
  // NOTA: restore() solo cambia la visibilidad a 'active', no revierte el texto al pasado.
  store.restore("backend-api", saved.id);
  console.log("Búsqueda tras restaurar:", store.search("backend-api", "SQLite").length); // 1

} catch (error) {
  if (error instanceof MemoryError) {
    console.error(`Error del sistema de memoria [${error.code}]:`, error.message);
  } else {
    console.error("Error inesperado del sistema de archivos o SQLite:", error);
  }
} finally {
  store.close();
}
```

---

## 3. Catálogo de Métodos de `MemoryStore`

### `constructor(path?: string)`
Crea la instancia del almacén. Si se omite `path`, utiliza `defaultDatabasePath()` (`~/.forge614/engram.db`).

### `save(input: SaveInput): MemoryVersion`
Guarda una memoria o actualiza una existente.
- **Diferencia frente a la CLI:** En el SDK el campo `type` es **estrictamente obligatorio** (`SaveInput.type`).
- **Parámetros obligatorios:** `project`, `title`, `content`, `type`.
- **Parámetros opcionales:** `topicKey`, `pinned` (booleano), `expectedVersion` (entero $\ge 1$), `requestKey`.
- **Retorno:** Devuelve el objeto `MemoryVersion` con la foto guardada.

### `get(project: string, id: string): Memory | null`
Obtiene la memoria activa o archivada según su ID. Devuelve `null` si no existe.

### `search(project: string, query: string, limit = 10): SearchResult[]`
Busca todas las notas activas cuyas palabras coincidan con la consulta. `limit` por defecto es 10 (rango: 1..100).

### `history(project: string, id: string): MemoryVersion[]`
Devuelve la lista cronológica de fotos de contenido ordenadas por `version ASC`. Devuelve `[]` si el ID no existe.

### `archive(project: string, id: string): Memory`
Marca el estado del recuerdo como `'archived'`. Lanza `NOT_FOUND` si no existe.

### `restore(project: string, id: string): Memory`
Restaura un recuerdo previamente archivado al estado `'active'`. Lanza `NOT_FOUND` si no existe.

### `close(): void`
Cierra la conexión con SQLite de forma segura e idempotente.

---

## 4. Tipos de Datos e Interfaces

```typescript
export const memoryTypes = ["fact", "decision", "procedure", "warning", "preference"] as const;
export type MemoryType = (typeof memoryTypes)[number];

export interface SaveInput {
  project: string;
  title: string;
  content: string;
  type: MemoryType;
  topicKey?: string;
  pinned?: boolean;
  expectedVersion?: number;
  requestKey?: string;
}

export interface MemoryVersion {
  id: string;
  project: string;
  topicKey: string | null;
  title: string;
  content: string;
  type: MemoryType;
  pinned: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface Memory extends MemoryVersion {
  state: "active" | "archived";
}

export interface SearchResult {
  memory: Memory;
  explanation: {
    mode: "fts5" | "literal";
    bm25: number | null;
    multiplier: number;
    orderScore: number | null;
  };
}
```
