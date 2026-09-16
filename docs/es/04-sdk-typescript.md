# Guía de Integración con el SDK de TypeScript

> **Etapa:** Etapa 1 — Memoria Local  
> **Estado:** Vigente y Activo  
> **Traducción hermana:** [English Version](../en/04-typescript-04-sdk-typescript.md)

Esta guía explica cómo importar y utilizar la clase `MemoryStore` en tus propias aplicaciones y scripts de TypeScript dentro de este repositorio.

---

## 1. Importación y Ciclo de Vida de la Conexión

Forge614 Engram exporta su interfaz principal directamente desde `src/index.ts`:

```typescript
import {
  MemoryStore,
  MemoryError,
  memoryTypes,
  type SaveInput,
  type Memory,
  type MemoryVersion,
  type SearchResult,
} from "./src/index";
```

### Inicialización de la Base de Datos
Para crear una instancia de almacenamiento debes proporcionar una ruta al archivo SQLite:

```typescript
// Almacenamiento persistente en disco (crea carpetas y archivo si no existen)
const store = new MemoryStore("./.forge614/example.sqlite");

// O almacenamiento en memoria volátil (desaparece por completo al cerrar)
const memoryOnlyStore = new MemoryStore(":memory:");
```

> [!IMPORTANT]
> **Cierre limpio de recursos:** La conexión con SQLite debe cerrarse al terminar de operar para liberar descriptores de archivo y sincronizar los registros del diario WAL. Utiliza siempre la estructura `try { ... } finally { store.close(); }`.

---

## 2. Ejemplo Completo y Funcional

Crea un script (por ejemplo en `scratch/example.ts`) y ejecútalo con `bun run scratch/example.ts`:

```typescript
import { MemoryStore, MemoryError } from "./src/index";

// 1. Abrir la conexión a la base de datos
const store = new MemoryStore("./.forge614/app-memory.sqlite");

try {
  // 2. Guardar un recuerdo inicial con clave temática
  const saved = store.save({
    project: "backend-api",
    title: "Motor de Base de Datos",
    content: "Utilizamos PostgreSQL para producción y SQLite para pruebas",
    type: "decision",
    topicKey: "architecture/storage",
    requestKey: "req-001",
  });

  console.log("Recuerdo guardado con ID:", saved.id);
  console.log("Versión actual:", saved.version);

  // 3. Buscar recuerdos activos relacionados con SQLite
  const searchResults = store.search("backend-api", "SQLite", 5);
  for (const item of searchResults) {
    console.log(`[Coincidencia] ${item.memory.title}: ${item.memory.content}`);
    console.log(`Modo: ${item.explanation.mode}, Puntaje: ${item.explanation.orderScore}`);
  }

  // 4. Recuperar la ficha completa del recuerdo
  const current = store.get("backend-api", saved.id);
  if (current) {
    console.log("Estado de la memoria:", current.state); // "active"
  }

  // 5. Actualizar a la versión 2 (requiere expectedVersion)
  const updated = store.save({
    project: "backend-api",
    title: "Motor de Base de Datos",
    content: "Utilizamos PostgreSQL 16 con extensión pgvector en producción",
    type: "decision",
    topicKey: "architecture/storage",
    expectedVersion: 1, // Coincide con la versión 1 existente
    requestKey: "req-002",
  });

  console.log("Nueva versión guardada:", updated.version); // 2

  // 6. Consultar la auditoría completa de versiones
  const historyList = store.history("backend-api", saved.id);
  console.log(`Total de versiones históricas: ${historyList.length}`);
  for (const snap of historyList) {
    console.log(` -> Versión ${snap.version} (${snap.updatedAt}): ${snap.content}`);
  }

  // 7. Archivar el recuerdo (lo retira de búsquedas activas)
  store.archive("backend-api", saved.id);
  console.log("Búsqueda tras archivar:", store.search("backend-api", "SQLite").length); // 0

  // 8. Restaurar el recuerdo
  store.restore("backend-api", saved.id);
  console.log("Búsqueda tras restaurar:", store.search("backend-api", "SQLite").length); // 1

} catch (error) {
  if (error instanceof MemoryError) {
    console.error(`Error del sistema de memoria [${error.code}]:`, error.message);
  } else {
    console.error("Error inesperado del sistema de archivos o SQLite:", error);
  }
} finally {
  // Aseguramos el cierre de la base de datos siempre
  store.close();
}
```

---

## 3. Catálogo de Métodos de `MemoryStore`

### `save(input: SaveInput): MemoryVersion`
Guarda una memoria o actualiza una existente.
- **Diferencia frente a la CLI:** En el SDK el campo `type` es **estrictamente obligatorio** (`SaveInput.type`).
- **Parámetros obligatorios:** `project`, `title`, `content`, `type`.
- **Parámetros opcionales:** `topicKey`, `pinned` (booleano), `expectedVersion` (número entero $\ge 1$), `requestKey`.
- **Retorno:** Devuelve el objeto `MemoryVersion` con la foto guardada.
- **Excepciones:** Lanza `MemoryError` si los datos son inválidos, si hay colisión de versión (`VERSION_CONFLICT`), si se reusa la clave con datos distintos (`REQUEST_CONFLICT`) o si el tema está archivado (`ARCHIVED`).

### `get(project: string, id: string): Memory | null`
Obtiene la memoria activa o archivada según su ID.
- **Comportamiento:** A diferencia de la terminal (que lanza error), si el ID no existe en el proyecto el SDK devuelve `null`.

### `search(project: string, query: string, limit?: number): SearchResult[]`
Busca todas las notas activas cuyas palabras coincidan con la consulta.
- `limit` es opcional (predeterminado: 10, rango permitido: 1 a 100).
- Devuelve un arreglo de objetos `SearchResult`, donde cada elemento incluye el objeto `memory` y el bloque `explanation`.

### `history(project: string, id: string): MemoryVersion[]`
Devuelve la lista cronológica de fotos de contenido ordenadas por `version ASC`.
- Si el identificador no existe en el proyecto, devuelve un arreglo vacío `[]`.

### `archive(project: string, id: string): Memory`
Marca el estado del recuerdo como `'archived'` y registra un evento en la base de datos.
- Si el ID no existe, lanza `MemoryError("NOT_FOUND")`.

### `restore(project: string, id: string): Memory`
Restaura un recuerdo previamente archivado al estado `'active'` y registra el evento.
- Si el ID no existe, lanza `MemoryError("NOT_FOUND")`.

### `close(): void`
Cierra la conexión con SQLite. Puede llamarse múltiples veces de forma segura (es idempotente).

---

## 4. Tipos e Interfaces de Dominio

```typescript
// Categorías válidas de recuerdos
export const memoryTypes = ["fact", "decision", "procedure", "warning", "preference"] as const;
export type MemoryType = (typeof memoryTypes)[number];

// Entrada para guardar
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

// Foto histórica inmutable
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

// Recuerdo completo con estado de visibilidad
export interface Memory extends MemoryVersion {
  state: "active" | "archived";
}

// Resultado de búsqueda con explicación de orden
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

---

## 5. Manejo de Excepciones y Errores

El SDK define la clase `MemoryError`:

```typescript
export class MemoryError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "MemoryError";
  }
}
```

> [!WARNING]
> No todos los errores lanzados durante la ejecución serán instancias de `MemoryError`. Si el disco está lleno, si no hay permisos de escritura en la carpeta o si el archivo SQLite está dañado físicamente a nivel de sistema operativo, el motor de Bun o Node pueden propagar errores nativos de tipo `Error` o `SQLiteError`. Asegúrate de envolver tus operaciones en bloques de captura generales.
