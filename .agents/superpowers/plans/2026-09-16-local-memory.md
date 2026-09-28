# Memoria local: plan de implementación

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking. Execute inline in the current session.

**Goal:** Entregar el primer paso utilizable: memoria local versionada y búsqueda textual.

**Architecture:** Un almacén SQLite mantiene contenido, revisiones y eventos en
transacciones. Una CLI y el SDK comparten las mismas reglas. No se implementan
todavía interfaces de red ni funciones semánticas.

**Tech Stack:** TypeScript estricto, Bun >=1.3.8, bun:sqlite, FTS5, bun:test.

**Spec:** [Diseño](../specs/2026-09-16-local-memory-design.md).

## Global Constraints

- Bun >=1.3.8, TypeScript estricto, SQLite local con FTS5 y tokenizador trigram.
- Ninguna llamada a modelos, telemetría, nube, pago ni cambio de configuración global.
- Documentación equivalente en `docs/es/` y `docs/en/`: lenguaje sencillo primero,
  término técnico entre paréntesis. Notion tendrá ramas Español/English.
- No publicar ni hacer push. Repositorio vacío: trabajar en una rama dedicada.

## Tarea 1: persistencia y búsqueda

Archivos: `src/domain.ts`, `src/schema.ts`, `src/store.ts`, `src/index.ts`,
`tests/store.test.ts`, `package.json`, `tsconfig.json`, `.gitignore`.

Interfaz producida: `new MemoryStore(path)`, `save(input)`, `get(project,id)`,
`history(project,id)`, `search(project,query,limit=10)`, `archive(project,id)`,
`restore(project,id)`, `close()`. Las escrituras retornan MemoryVersion; get
retorna Memory con estado actual o null; search retorna resultados explicados.

- [x] Añadir pruebas que detecten pérdida de datos al cerrar/reabrir, acceso entre
  proyectos, pérdida de historia, índice desactualizado y duplicación de reintentos.
  Contrato base:
  ```ts
  const saved = store.save({project: 'demo', title: 'Base', content: 'SQLite', type: 'decision'});
  expect(store.get('demo', saved.id)?.content).toBe('SQLite');
  expect(store.get('otro', saved.id)).toBeNull();
  ```
- [x] Ejecutar `bun test tests/store.test.ts` y comprobar fallo por función ausente.
- [x] Implementar tipos, migración, transacciones y búsqueda:
  ```ts
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;');
  // Cada operación que cambia una memoria utiliza db.transaction(operation).immediate().
  ```
- [x] Ejecutar pruebas: reintento con misma clave debe retornar versión original;
  expectedVersion obsoleta debe fallar sin crear versión ni cambiar contenido.
- [x] Ejecutar `bun run typecheck` y corregir errores de tipos.

## Tarea 2: herramienta de terminal

Archivos: `src/cli.ts`, `tests/cli.test.ts`.
Consume MemoryStore. Produce comandos `save`, `search`, `get`, `history`,
`archive`, `restore`, `help`, con `--db` y `--project` explícitos en ejemplos.

- [x] Escribir pruebas de procesos independientes usando un directorio temporal:
  ```ts
  const result = Bun.spawnSync([process.execPath, 'src/cli.ts', 'help']);
  expect(result.exitCode).toBe(0);
  ```
  Comprobar además guardado/lectura JSON, código 1 ante errores, argumentos desconocidos,
  ausencia de escritura al solicitar ayuda y al pasar argumentos inválidos.
- [x] Ejecutar `bun test tests/cli.test.ts`, verificar fallo de comportamiento.
- [x] Implementar validación de argumentos antes de abrir la base; usar
  `console.log(JSON.stringify(result, null, 2))` solo para resultados y
  `console.error(JSON.stringify({error: message}))` para errores sin contenido.
- [x] Ejecutar `bun test` y `bun run typecheck`.

## Tarea 3: traspaso documental y comprobación final

El usuario documentará con otro modelo: entregar un prompt por etapa para
`docs/es/`, `docs/en/` y Notion. Los documentos de proceso permanecen en
docs/superpowers; no crear aquí guías bilingües ni publicar en Notion.

- [x] Entregar en el prompt instalación, ubicación de datos, cada comando y parámetro,
  ejemplos verificables, errores, privacidad, límites y recuperación.
- [x] Distinguir comportamiento existente, propuesta y entrega pendiente.
- [x] Incluir fórmula implementada y diferenciar fórmulas futuras.
- [x] Ejecutar ejemplos con una base temporal.
- [x] Ejecutar `bun test`, `bun run typecheck`, `git diff --check`.
- [x] Registrar resultados y siguiente entrega sin afirmar que el motor completo está terminado.

## Resultado de esta etapa

Implementados CLI y SDK, persistencia SQLite, búsqueda textual, versiones,
claves de petición y archivo/restauración. Revisados errores de identificadores
con espacios, mayúsculas acentuadas y reutilización de consultas limitadas.
Se verifican 23 pruebas sobre almacenamiento real y CLI; TypeScript sin errores.
El encargo documental está en `docs/handoffs/01-documentation-prompt.md`.
Siguiente entrega: sesiones, MCP y HTTP local. Semántica y feedback siguen pendientes.
Sin publicación, push ni cambios de configuración global.
