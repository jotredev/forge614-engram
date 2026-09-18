# Entrega 12 — Centro de control TUI

Estado: implementación verificada y revisión independiente aprobada.
Rama `feat/tui-control-center`. Esta entrega no hace commit, push, PR, merge ni
actualiza directamente docs/es, docs/en o Notion.

## Función

`forge614-engram tui` abre un centro de control de terminal, no una interfaz
gráfica ni servidor. Empieza siempre en lectura:

```text
Summary | Projects | Shared | Storage | Actions | Assistants | Exit
```

Abrir, navegar, redimensionar o una entrada inválida no crea configuración, base,
proyecto, vínculo, capacidad ni sincronización. Antes de la confirmación final,
cancelar, Escape, Ctrl+C o EOF tampoco escriben. Si una operación ya fue confirmada
y comenzó, la terminal se restaura pero esa operación no se promete revertir. Si no
hay configuración, explica que se use `setup` o `init`; no crea nada.

Projects muestra nombre, UUID abreviado y conteos; el detalle muestra UUID completo,
fechas y directorios locales vinculados. Los nombres no sustituyen `projectId`.
Shared muestra solo conteos globales explícitos. Storage muestra SQLite, esquema 3–7,
capacidades y si PostgreSQL está configurado. Nunca se muestran `.env`, POSTGRES_URL,
contenido de recuerdos, títulos de recuerdos ni configuración de asistentes.

Todos los textos externos se sanean para controles, ANSI, bidi, zero-width, celdas
no ASCII y URLs, incluso si una URL sigue a `_` o un número. Ocultar la URL no prueba
conectividad remota.

## Acciones

Las acciones requieren vista previa, escribir `confirm` sin importar mayúsculas y
Enter. Enter solo nunca autoriza escribir.

| Acción | Efecto |
| --- | --- |
| Create project | Crea proyecto con UUID nuevo. |
| Rename project | Cambia etiqueta y conserva UUID/recuerdos. |
| Bind directory | Vincula ruta absoluta al UUID, sin adivinar por nombre. |
| Enable assistant integration | Esquema 5; conserva recuerdos; no downgrade. |
| Enable sessions | Esquema 6; conserva recuerdos; no downgrade. |
| Enable search reinforcement | Esquema 7; conserva recuerdos; no downgrade. |
| Synchronize now | Solo si PostgreSQL ya está configurado; no promociona formato ni instala servicio. |

La TUI no ejecuta SQL ni escritura de archivos. La aplicación usa MemoryWorkspace,
MemoryStore y syncWorkspace, cerrando recursos en `finally`. Si hace falta promoción,
solo `forge614-engram sync --upgrade-format` puede autorizarla. No hay acción TUI para
sync-watch, downgrade, migración implícita o servidor cloud.

Asistentes es un subflujo secuencial: el centro restaura la terminal, abre el
configurador existente con preview/confirmación, y al volver carga un resumen fresco.
No hay dos modos raw simultáneos. Durante una acción confirmada se ignoran teclas
duplicadas. Ctrl+C, EOF, error de entrada, SIGINT y SIGTERM restauran la terminal;
una acción ya iniciada no se promete revertir, pero no refresca ni dibuja al cerrar.

## Arquitectura y límites

Monolito modular por funcionalidad: `modules/control-center` contiene tipos,
SQLite calcula resúmenes sin contenido, `app/control-center` coordina y
`interfaces/tui` navega/renderiza. Cada archivo con lógica tiene test hermano;
flujos de colaboración están en `interfaces/tui/__tests__`. Esto no equivale a
cobertura completa de ramas.

No se añadieron embeddings, LLM, entrenamiento, cloud propio, health check remoto,
bases por proyecto, daemon, interfaz gráfica ni garantía de guardado del asistente.

## Evidencia final

- `FORGE614_TEST_POSTGRES_BIN=/tmp/engram-postgres-17.6.tTVxxc/postgres/bin bun test`:
  504 pruebas aprobadas, 0 fallos, 2566 aserciones, 82 archivos, 39.76 s.
- `bun run typecheck`: correcto.
- `git diff --check`: correcto.
- Revisión independiente final: aprobada; sin hallazgos Critical, Important o Minor
  pendientes. Las regresiones verifican entrada de terminal con mayúsculas, enlaces
  Git desde raíz/subdirectorio/symlink y snapshots sin estado compartido mutable.

## Prompt para documentación y Notion

```text
Actualiza docs/es, docs/en y Notion para la Entrega 12. Lee primero
docs/handoffs/12-tui-control-center.md, el diseño/plan 2026-09-17-tui-control-center,
el código final y la evidencia final. No cambies código, BD, configuración, secretos,
ni hagas commit/push/PR. Conserva navegación, enlaces y jerarquía. Si no tienes acceso
a Notion, informa el pendiente sin afirmar sincronización.

Produce inglés y español separados, con la misma semántica. Explicación cotidiana
primero y término técnico entre paréntesis. Documenta: menú y teclas; lectura por
defecto; una .env/engram.db y projectId/shared; información visible y oculta;
confirmación confirm; crear/renombrar/vincular; esquemas 5/6/7 sin downgrade;
PostgreSQL y sync sin promoción, con sync --upgrade-format separado; asistentes como
subflujo preview/confirmación; TTY, Ctrl+C/EOF/resize y acciones lentas; arquitectura
modular y tests colocados; comandos/resultados reales de verificación; y límites
(sin embeddings/LLM/cloud/health check/bases por proyecto). Usa UUID/rutas ficticios,
nunca URLs o datos reales. No recomiendes borrar/recrear datos ante error. Termina con
archivos/páginas modificados y pendientes.
```
