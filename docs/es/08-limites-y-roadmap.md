# 08. Límites de la Etapa y Hoja de Ruta Futura

> **Etapa:** MCP Local, Menú TUI de Asistentes, Memoria Local y Sincronización PostgreSQL Opcional
> **Versiones de esta entrega:** Programa 0.5.0 | Formato de configuración 2 (local) / 3 (con sync) | Esquema SQLite 3 (local) / 4 (con sync) / 5 (asistentes y asociaciones locales)
> **Estado:** Vigente y Verificado (191 pruebas totales en 16 archivos: 187 superadas y 4 omitidas sin binarios PG; 191 superadas, 0 fallos, 1133 aserciones con PostgreSQL aislado en macOS con Bun 1.3.8)
> **Traducción hermana:** [08 (EN). Stage Boundaries and Evolutionary Roadmap](../en/08-boundaries-and-roadmap.md)

Este documento declara con total transparencia qué capacidades se encuentran implementadas y verificadas en la versión 0.5.0, los límites técnicos y operativos vigentes, la distinción entre pruebas sintéticas y sesiones reales de clientes, y las 2 fases de desarrollo pendientes en la hoja de ruta oficial.

---

## 1. Capacidades Completadas y Verificadas (Versión 0.5.0)

Las siguientes fases de la hoja de ruta se encuentran **100% implementadas y verificadas**:

### Fase 1: Asistente Interactivo de Configuración Inicial (`setup`) — COMPLETADA
- [x] Guía paso a paso para personas en terminal interactiva (`stdin` y `stdout` TTY).
- [x] Rutas centrales del usuario: `~/.forge614/.env` y `~/.forge614/engram.db`.
- [x] Opciones exactas de sincronización: `No` (predeterminada) y `Sí, configurar PostgreSQL`.
- [x] Captura confidencial de URL de PostgreSQL con entrada oculta (`{ secret: true }`).
- [x] Confirmación explícita previa y salida con código estándar `130` en caso de cancelación voluntaria.
- [x] Rechazo controlado de entornos no interactivos con `INTERACTIVE_REQUIRED`.
- [x] No pide ni selecciona proyectos durante la configuración global.

### Fase 2: Sincronización Opcional Directa con PostgreSQL (`sync` / `sync-watch`) — COMPLETADA
- [x] Réplica directa de todo el espacio de trabajo hacia PostgreSQL (sin servidores Cloud propietarios).
- [x] Comandos `sync` (ronda única bajo demanda en JSON) y `sync-watch` (bucle en primer plano con intervalo configurable de 1 a 3600 segundos).
- [x] Resiliencia fuera de línea: SQLite y FTS5 se mantienen 100% locales; si PostgreSQL no está disponible, las operaciones locales continúan sin demoras ni errores.
- [x] Migración aditiva a Esquema 4 en SQLite (tabla `sync_checkpoints`).
- [x] Esquema dedicado `forge614_sync` en PostgreSQL con tablas `revisions` (hash SHA-256) y `state` (bloqueo optimista CAS).
- [x] Conciliación determinista de tres vías (*3-way merge*) con detección estricta de conflictos (`SYNC_CONFLICT`) y límite de 8 MiB por instantánea (`SYNC_TOO_LARGE`).

### Fase 3: Integración Local MCP y Menú TUI de Asistentes — COMPLETADA
- [x] **Servidor MCP nativo por stdio (`forge614-engram mcp`):** Implementado con el SDK oficial de MCP, con `stdout` reservado estrictamente para tramas JSON-RPC, sin escapes ANSI ni logs humanos.
- [x] **Cinco herramientas MCP de memoria:** `memory_current_project`, `memory_search`, `memory_get`, `memory_save` y `memory_history`.
- [x] **Menú TUI interactivo en terminal (`forge614-engram tui`):** Navegación con flechas, selección con Espacio, redetección con `r`, personalización oculta con `c`, previsualización de planes, confirmación explícita y salida limpia con código `130`.
- [x] **Autoprueba asíncrona del servidor MCP:** Ejecuta un apretón de manos con el SDK oficial sobre el ejecutable binario instalado, verificando el nombre del servidor y las 5 herramientas dentro de un plazo de 5 segundos, con cancelación limpia vía `Escape`.
- [x] **Adaptadores seguros para 5 clientes:** Claude Code, Codex, Cursor, OpenCode y Gemini CLI.
- [x] **Seguridad en archivos de clientes:** Permisos `0600`, copias de respaldo con sufijo UUID conteniendo los bytes anteriores exactos, preservación de comentarios JSONC/TOML, preflight riguroso y verificación posterior de bytes publicados (`PUBLISHED_UNVERIFIED` ante interferencias concurrentes).
- [x] **Migración aditiva a Esquema 5 en SQLite:** Tabla `project_bindings` para asociar rutas locales a `projectId` de forma independiente por equipo.
- [x] **Resolución canónica de proyectos por Git:** Uso de `git rev-parse --path-format=absolute --git-common-dir` para unificar ramas vinculadas (*linked worktrees*) y subcarpetas bajo la misma identidad de proyecto.
- [x] **Bloqueo conservador de proyectos desconocidos:** Si alguna ruta registrada en `project_bindings` no existe en el disco, Engram detiene la resolución con `PROJECT_BINDING_REQUIRED` para evitar crear proyectos huérfanos por error.
- [x] **Ganchos nativos de contexto (`memory-hook`):** Adaptador que emite recordatorios contextuales de inicio de sesión o envío de prompt para clientes compatibles, sin escribir recuerdos directamente.
- [x] **Compilación autónoma:** Binario compilado independiente que funciona sin Bun ni Node en ejecución habitual. Git obligatorio para comprobaciones de identidad.

---

## 2. Límites y Restricciones Vigentes

Para mantener expectativas estrictamente realistas, se declaran los siguientes límites:

1. **Cumplimiento voluntario de los modelos de IA:**
   Tener configurado el servidor MCP y los ganchos no garantiza que el modelo de lenguaje llame a las herramientas de memoria ni que decida guardar resúmenes. Los modelos de IA son probabilísticos y pueden omitir llamadas a herramientas a su propio criterio.
2. **Sin guardado garantizado ante cierre abrupto:**
   Si la terminal o el proceso del asistente se cierra bruscamente (por ejemplo, con `kill -9`, caída del sistema o cierre forzado de ventana), no es posible garantizar que el asistente guarde un resumen final de la sesión.
3. **Sin captura de transcripciones (*transcripts*):**
   Engram no captura transcripciones completas, conversaciones crudas, registros de depuración (*logs*) ni salidas extensas de herramientas. Su diseño almacena exclusivamente conocimiento curado y duradero.
4. **Sin modelo de IA en segundo plano (*Background LLM*):**
   Engram no ejecuta un modelo de inteligencia artificial propio de forma autónoma en segundo plano. No sintetiza ni genera notas por su cuenta sin una petición explícita.
5. **Sin gancho en bucle infinito (*Loop Stop Hook*):**
   Engram no mantiene ganchos activos en segundo plano interceptando cada acción del editor ni interfiriendo con el bucle de ejecución de los asistentes.
6. **Política de confianza manual en Codex (`/hooks`):**
   En Codex, los ganchos nuevos instalados por Engram no se ejecutan automáticamente: **el usuario debe abrir Codex y confiar en ellos explícitamente mediante `/hooks`**.
7. **Pruebas sintéticas (fixtures) vs Sesiones Reales de Asistentes:**
   La suite de pruebas automatizadas verifica exhaustivamente el protocolo con fixtures sintéticos, terminales virtuales (PTY con `/usr/bin/expect`) y el SDK oficial de MCP. Sin embargo, no se ejecutan sesiones humanas reales de los 5 clientes dentro de la suite de pruebas. Cada cliente debe ser verificado en su propio entorno real.
8. **Configurado no significa Conectado:**
   El menú TUI y el comando `assistant-list` distinguen claramente entre binario detectado y configuración escrita. Hasta que no reinicies tu cliente y verifiques la presencia de las herramientas en él, la sesión se considera no probada.
9. **Rutas locales no sincronizadas:**
   La tabla `project_bindings` es local a cada máquina. Los clones en otras computadoras conservan el UUID del proyecto gracias a la réplica PostgreSQL, pero requieren vincular la carpeta local explícitamente mediante `project-bind`.
10. **Recreación de rutas antiguas:**
    Si trasladas una carpeta y recreas la ruta antigua vacía, las rutas por sí solas no permiten distinguir automáticamente la carpeta movida sin vinculación manual explícita.
11. **Límite de tamaño de instantánea (8 MiB):**
    Cada snapshot completo tiene un tope de 8 MiB (`SYNC_TOO_LARGE`).
12. **Sin resolución automática de conflictos en sincronización:**
    Modificaciones concurrentes sobre una misma entidad producen `SYNC_CONFLICT`. No existe fusión heurística de textos en conflicto en esta versión.
13. **`sync-watch` en primer plano:**
    No se instalan demonios de sistema (*systemd*, *launchd*).
14. **Búsqueda BM25 trigram literal:**
    El buscador se basa en coincidencias de texto exacto y trigramas en SQLite FTS5; no realiza búsqueda semántica mediante vectores ni *embeddings*.

---

## 3. Hoja de Ruta: Fases Pendientes Oficiales

Habiéndose completado la **Fase 1 (Setup Interactivo)**, la **Fase 2 (Sincronización PostgreSQL)** y la **Fase 3 (MCP Local y Menú TUI de Asistentes)**, el desarrollo futuro se concentra en las siguientes 2 fases:

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
│ [ ] Fase 4: Búsqueda Semántica y Ponderación Avanzada  │ (Pendiente)
│     - Generación local de embeddings vectoriales       │
│     - Búsqueda híbrida (FTS5 BM25 + similitud coseno)   │
│     - Presupuesto inteligente de tokens para contexto   │
└──────────────────────────┬─────────────────────────────┘
                           ▼
┌────────────────────────────────────────────────────────┐
│ [ ] Fase 5: Interfaz Visual Completa de Gestión (TUI)  │ (Pendiente)
│     - Explorador interactivo de recuerdos en terminal  │
│     - Edición visual de temas y versiones              │
│     - Resolución interactiva de conflictos de réplica  │
└────────────────────────────────────────────────────────┘
```

### Detalle de las Fases Pendientes:

1. **Fase 4: Búsqueda Semántica y Ponderación Avanzada (Embeddings)**
   - Incorporar un modelo SLM local de generación de vectores semánticos sin dependencias de servicios externos.
   - Ponderación híbrida que combine la precisión de trigramas BM25 con la similitud conceptual de vectores.
   - Adaptación automática al presupuesto de tokens disponible en la ventana de contexto del cliente.
2. **Fase 5: Interfaz Visual Completa de Gestión de Recuerdos (TUI de Memoria)**
   - Panel visual interactivo en terminal para examinar, filtrar, editar y archivar recuerdos directamente.
   - Herramienta visual interactiva para resolver manualmente conflictos de sincronización entre réplicas cuando ocurra `SYNC_CONFLICT`.
