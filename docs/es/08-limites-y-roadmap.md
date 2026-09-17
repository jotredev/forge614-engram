# 08. Límites de la Etapa y Hoja de Ruta Futura

> **Etapa:** Sesiones Progresivas de Memoria, Contexto Clasificado, MCP Local (10 Herramientas), Menú TUI de Asistentes y Réplica PostgreSQL Formato 2
> **Versiones de esta entrega:** Programa 0.5.0 | Formatos de configuración 2 (local) / 3 (con sync) | Esquemas SQLite 3 (local) / 4 (con sync) / 5 (asistentes y asociaciones locales) / 6 (sesiones progresivas y contexto clasificado) | Formatos PostgreSQL 1 y 2
> **Estado:** Vigente y Verificado (250 pruebas totales en 18 archivos: 243 superadas y 7 omitidas sin binarios PG; 250 superadas, 0 fallos, 1506 aserciones con PostgreSQL aislado en macOS con Bun 1.3.8)
> **Traducción hermana:** [08 (EN). Stage Boundaries and Evolutionary Roadmap](../en/08-boundaries-and-roadmap.md)

Este documento declara con total transparencia qué capacidades se encuentran implementadas y verificadas en la entrega actual, los límites técnicos y operativos vigentes, la distinción entre pruebas sintéticas y sesiones reales de clientes, y las fases de desarrollo pendientes en la hoja de ruta oficial.

---

## 1. Capacidades Completadas y Verificadas

Las siguientes fases de desarrollo se encuentran **100% implementadas y verificadas**:

### Fase 1: Asistente Interactivo de Configuración Inicial (`setup`) — COMPLETADA
- [x] Guía paso a paso para personas en terminal interactiva (`stdin` y `stdout` TTY).
- [x] Rutas centrales del usuario: `~/.forge614/.env` y `~/.forge614/engram.db`.
- [x] Captura confidencial de URL de PostgreSQL con entrada oculta (`{ secret: true }`).
- [x] Confirmación explícita previa y salida con código estándar `130` en caso de cancelación voluntaria.

### Fase 2: Sincronización Directa con PostgreSQL (`sync` / `sync-watch`) — COMPLETADA
- [x] Réplica directa de todo el espacio de trabajo hacia PostgreSQL.
- [x] Comandos `sync` (ronda única en JSON) y `sync-watch` (bucle continuo con intervalo configurable).
- [x] Resiliencia fuera de línea: SQLite y FTS5 se mantienen 100% locales; si PostgreSQL no está disponible, las operaciones locales continúan sin demoras ni errores.
- [x] Conciliación determinista de tres vías (*3-way merge*) con detección estricta de conflictos (`SYNC_CONFLICT`) y límite de 8 MiB por instantánea (`SYNC_TOO_LARGE`).

### Fase 3: Integración Local MCP y Menú TUI de Asistentes — COMPLETADA
- [x] Servidor MCP nativo por stdio con canales limpios (stdout exclusivo para JSON-RPC).
- [x] Menú TUI interactivo en terminal (`forge614-engram tui`) con navegación por teclado, vista previa y confirmación segura.
- [x] Autoprueba asíncrona del servidor MCP verificando binario y herramientas en 5 segundos.
- [x] Adaptadores seguros para 5 clientes (Claude Code, Codex, Cursor, OpenCode y Gemini CLI) con respaldos `0600`/UUID y verificación posterior de bytes publicados.
- [x] Esquema 5 en SQLite con tabla `project_bindings` para resolver canónicamente identidades por Git.

### Fase 4: Sesiones Progresivas de Memoria y Contexto Clasificado — COMPLETADA
- [x] **Esquema 6 en SQLite:** Tablas `sessions`, `session_entries`, `session_summaries`, `local_session_bindings` y `local_manual_sessions`.
- [x] **Comando `sessions-enable`:** Migración aditiva irreversible y explícita; apertura normal, mcp e init jamás auto-migran la base.
- [x] **Ciclo de vida completo de sesiones:** Comandos CLI `session-start`, `session-end` y `session-summary` y herramientas MCP correspondientes.
- [x] **Resúmenes estructurados de sesión:** Validación rigurosa de 6 campos (`goal`, `instructions`, `discoveries`, `accomplishments`, `nextSteps`, `files`) bajo el tema reservado `session/<id>/summary` con tipo `procedure`.
- [x] **Contexto clasificado (`context` / `memory_context`):** Ensamblado estructurado en tres secciones (`pinned`, `recent`, `summaries`) con contadores de omisión y bandera booleana `truncated`.
- [x] **Presupuesto estricto de bytes (`--max-bytes`):** Control numérico estricto entre 1024 y 65536 bytes UTF-8 del JSON resultante.
- [x] **Línea temporal de sucesos (`timeline` / `memory_timeline`):** Reconstrucción cronológica alrededor de un recuerdo de enfoque con vecinos anteriores y posteriores.
- [x] **Vistas previas progresivas (`--preview` y `searchPreviews`):** Fichas reducidas a un máximo de 300 puntos de código Unicode con indicación de truncamiento.
- [x] **10 Herramientas MCP Nativas:** Suite completa de herramientas de memoria expuestas a los modelos.
- [x] **Promoción a Formato 2 en PostgreSQL:** Soporte de réplica para sesiones y resúmenes promovido exclusivamente con `sync --upgrade-format` bajo CAS atómico en `forge614_sync.state`.
- [x] **Resolución segura de conflictos en OpenCode:** Falla cerrada con `CONFLICT` si el plugin dedicado existe con contenido divergente, exigiendo conciliación manual sin sobrescrituras destructivas.
- [x] **250 pruebas automatizadas en 18 archivos:** Cobertura exhaustiva en macOS con Bun 1.3.8 (1506 aserciones).

---

## 2. Límites y Restricciones Vigentes

Para mantener expectativas estrictamente realistas, se declaran los siguientes límites:

1. **Presupuesto de bytes vs Presupuesto de tokens:**
   El parámetro `--max-bytes` delimita el tamaño total del texto serializado en formato JSON (en bytes UTF-8) transferido entre procesos. **No es una gestión interna de la ventana de contexto de tokens del modelo de IA**.
2. **Previsualizaciones en puntos de código:**
   Las fichas abreviadas se delimitan en puntos de código Unicode (300 en vistas previas y contexto; 500 para el foco y 150 para vecinos en timeline), garantizando integridad de caracteres sin cortar secuencias UTF-8 a mitad de un byte.
3. **Cumplimiento voluntario de los modelos de IA:**
   Tener configurado el servidor MCP y los ganchos no garantiza que el modelo de lenguaje llame a las herramientas de memoria ni que decida guardar resúmenes. Los modelos de IA son probabilísticos y pueden omitir llamadas a herramientas a su propio criterio.
4. **Sin guardado garantizado ante cierre abrupto:**
   Si la terminal o el proceso del asistente se cierra bruscamente (por ejemplo, con `kill -9` o cierre forzado de ventana), no es posible garantizar que el asistente guarde un resumen final de la sesión.
5. **Sin captura de transcripciones:**
   Engram no captura transcripciones completas, conversaciones crudas, registros de depuración (*logs*) ni salidas extensas de herramientas.
6. **Sin modelo de IA en segundo plano:**
   Engram no ejecuta un modelo propio de lenguaje de forma autónoma en segundo plano; no sintetiza notas sin una petición explícita.
7. **Política de confianza manual en Codex (`/hooks`):**
   En Codex, los ganchos nuevos instalados por Engram deben ser aprobados explícitamente por el usuario mediante `/hooks`.
8. **Pruebas sintéticas vs Sesiones Reales de Asistentes:**
   La suite de pruebas automatizadas verifica el protocolo con fixtures sintéticos y terminales virtuales (PTY). Cada cliente de IA debe ser verificado en su propio entorno real.
9. **Rutas locales no sincronizadas:**
   Las tablas `project_bindings`, `local_session_bindings` y `local_manual_sessions` son exclusivas de cada máquina física y jamás se transmiten a la réplica PostgreSQL.
10. **Límite de tamaño de instantánea (8 MiB):**
    Cada instantánea combinada de sincronización tiene un tope estricto de 8 MiB (`8,388,608 bytes`), arrojando `SYNC_TOO_LARGE` si se excede.
11. **Sin resolución automática de conflictos en sincronización:**
    Modificaciones concurrentes sobre una misma entidad producen `SYNC_CONFLICT`. No existe fusión heurística de textos en conflicto en esta versión.
12. **Búsqueda BM25 trigram literal:**
    El buscador se basa en coincidencias de texto exacto y trigramas en SQLite FTS5; no realiza búsqueda semántica mediante vectores ni *embeddings*.

---

## 3. Hoja de Ruta: Fases Pendientes Oficiales

Habiéndose completado las Fases 1 a 4, el desarrollo futuro se concentra en las siguientes fases:

```text
┌────────────────────────────────────────────────────────┐
│ [x] Fase 1: Asistente Interactivo de Configuración      │ (Completada v0.3.0)
└──────────────────────────┬─────────────────────────────┘
                           ▼
┌────────────────────────────────────────────────────────┐
│ [x] Fase 2: Sincronización Directa con PostgreSQL      │ (Completada v0.4.0)
└──────────────────────────┬─────────────────────────────┘
                           ▼
┌────────────────────────────────────────────────────────┐
│ [x] Fase 3: Servidor MCP Local y Menú TUI de Clientes  │ (Completada v0.5.0)
└──────────────────────────┬─────────────────────────────┘
                           ▼
┌────────────────────────────────────────────────────────┐
│ [x] Fase 4: Sesiones Progresivas y Contexto Clasificado│ (Completada v0.5.0)
└──────────────────────────┬─────────────────────────────┘
                           ▼
┌────────────────────────────────────────────────────────┐
│ [ ] Fase 5: Búsqueda Semántica y Ponderación Avanzada  │ (Pendiente)
│     - Generación local de embeddings vectoriales       │
│     - Búsqueda híbrida (FTS5 BM25 + similitud coseno)   │
│     - Asignación adaptativa de tokens al contexto      │
└──────────────────────────┬─────────────────────────────┘
                           ▼
┌────────────────────────────────────────────────────────┐
│ [ ] Fase 6: Interfaz Visual Completa de Gestión (TUI)  │ (Pendiente)
│     - Explorador interactivo de recuerdos en terminal  │
│     - Edición visual de temas, versiones y sesiones    │
│     - Conciliación interactiva de conflictos de réplica │
└────────────────────────────────────────────────────────┘
```

> [!NOTE]
> Siguiendo las directrices de diseño honesto, las Fases 5 y 6 se documentan como hitos conceptuales aprobados pendientes de implementación, sin prometer fechas ni números de versión definitivos.
