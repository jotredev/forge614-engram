# 08. Límites Vigentes y Hoja de Ruta

## Límite actual del producto

Forge614 Engram es el motor de memoria persistente del ecosistema Forge614. Es dueño de una base SQLite/FTS5 local, identidades de proyecto, recuerdos compartidos, sesiones, búsqueda, su servidor MCP por `stdio` y su SDK público de TypeScript.

Intencionalmente **no** es un espacio visual, detector de asistentes, configurador de asistentes, administrador de hooks ni cliente de chat. Esas responsabilidades pertenecen a Forge614 Shell y Forge614 Engines mediante contratos públicos.

## Capacidades disponibles en v1.2.1

- Hogar privado en `~/.forge614/engram/` con `engram.db`, `.env` y `bin/`; `FORGE614_HOME` absoluta sustituye la raíz `~/.forge614` para aislar una instalación completa. Una variable vacía o relativa falla con `INVALID_FORGE614_HOME`, sin volver en silencio al hogar real.
- SQLite y FTS5 locales para todos los proyectos y recuerdos compartidos. La búsqueda local funciona sin red.
- Réplica opcional PostgreSQL configurada de forma no interactiva con `init --json --postgres-url <URL>`.
- Recuerdos por proyecto y compartidos, consulta exacta por tema, historial, archivo/restauración, búsqueda FTS5, vistas previas, contexto, sesiones y refuerzo.
- Servidor MCP local por `stdio`, iniciado con `forge614-engram mcp`.
- SDK público para consumidores como Forge614 Atlas, incluyendo `MemoryWorkspace`, `MemoryStore`, APIs de inicialización y `MemoryStore.getByTopic()`.
- Instalación, actualización y desinstalación seguras. `forge614-engram update` instala el último release estable después de verificar su checksum.

## Capacidades incorporadas en v1.6.0

- Ámbito `ecosystem`: memoria compartida entre los repositorios de un **grupo**, con los mismos temas, versiones, archivo/restauración y refuerzo; precedencia proyecto, ecosistema, `shared`. Consulta [11. Ámbitos y Ecosistemas](11-ambitos-y-ecosistemas.md).
- Identidad portátil del proyecto en `.forge614/project.json`, propiedad de Engram; se resuelve por `id`, no por ruta.
- Comandos `group-*` y `memory-move`; `--scope ecosystem --group` en la CLI; `scope: "ecosystem"` con `groupIntent` en MCP; protocolo público versión 3; bloque `ecosystem` en `startup-context` y `context`.
- Actualización aditiva de la base con respaldo automático y verificación (niveles 8, 9 y 10).

Límites de esta entrega: las memorias de ámbito `ecosystem` no se replican todavía: la réplica PostgreSQL rechaza (`SYNC_ECOSYSTEM_UNSUPPORTED`) mientras existan; la replicación de grupos llegará en un plan propio (1.8.0, «formato 4»). Engram solo lee `forge614.node.json` y nunca infiere un grupo. La pregunta de a qué grupo pertenece un proyecto sin declaración es del flujo visual de Shell. Que Engines y Shell inyecten el bloque `ecosystem` es un trabajo de esos productos: Engram publica el contrato, no demuestra que ya lo consuman.

## Capacidades incorporadas en v1.7.0

- Esquema 11 (memoria inteligente): una base nueva nace en ese nivel y una base existente lo activa solo con `intelligence-enable`, con respaldo y verificación. Consulta [05. Arquitectura Interna y Fórmulas](05-arquitectura-interna-y-formulas.md).
- Filtro de secretos al guardar y metadatos del recuerdo (versión corta, vigencia, reemplazo y proyectos afectados).
- Búsqueda híbrida y recuerdos parecidos al guardar.
- Sesiones interrumpidas: la sesión anterior se ofrece como `previous`.
- Reglas del tablero del grupo: nota de estado, proyecto fuente y bajar un recuerdo al proyecto. Consulta [11. Ámbitos y Ecosistemas](11-ambitos-y-ecosistemas.md).
- Bloque de arranque (formato 2), listo para inyectar. Consulta [10. Contexto de Inicio](10-contexto-de-inicio.md).
- Protocolo v4 (manual de la memoria inteligente) con instrucciones del servidor MCP y descripciones de campos. Consulta [09. Protocolo Público de Memoria](09-protocolo-publico-de-memoria.md).

Límite de esta entrega: la replicación de grupos (formato 4) llegará en 1.8.0.

## Capacidades incorporadas en v1.7.1

- Sesiones en paralelo según la hora: `parallel` reporta las otras sesiones abiertas del proyecto con actividad en los últimos 30 minutos; `previous` ahora solo se reporta cuando una sesión lleva más de 30 minutos sin actividad, y ya nadie queda marcado al abrir una sesión.
- Texto del bloque de arranque: la sección «Previous session» ahora dice que una sesión «was left open» (se quedó abierta).
- Manual del protocolo v4: ahora pide decirle a la persona que hay otra sesión abierta ahora (`parallel`), distinguiéndola de una que se quedó abierta (`previous`), y explicarle por qué un guardado parecido se deja aparte.

Límites de esta entrega: (1) una sesión que trabaja más de 30 minutos sin guardar nada a través de Engram se verá «sin cerrar» desde otra sesión; (2) tras compactar, si la propia sesión lleva más de 30 minutos sin actividad en Engram, el bloque de arranque puede nombrarla como «left open» (es dato, y `memory_session_start` al repetirse no devuelve `previous`).

## No objetivos explícitos

- No hay TUI ni centro de control de terminal en Engram.
- No hay detección de IA instalada, selección de clientes, hooks, plugins ni escrituras de configuración MCP.
- No existe catálogo de adaptadores de OpenCode, Antigravity, Cursor, Claude Code, Codex o Gemini en este producto.
- Aún no hay release ni instalador de Windows. Los binarios oficiales actuales son para macOS y Linux.
- No hay embeddings ni búsqueda exclusiva en nube. FTS5 y SQLite siguen siendo la ruta local primaria.
- La inicialización no crea ni selecciona proyectos automáticamente.

`FORGE614_HOME` no es una segunda base ni una configuración por proyecto: es una raíz única alternativa para una instalación completa. SQLite, `.env`, binarios, actualización y desinstalación derivan de ella. Las rutas relativas se rechazan para evitar que el directorio de trabajo cambie el destino de datos.

## Protocolo público de memoria: estado de integración

El contrato `forge614-engram-memory` versión `1` está disponible desde la release `v1.3.0` y se puede inspeccionar con `forge614-engram memory-protocol --json`. Su publicación no significa que una integración de asistentes ya esté instalada. La versión 4 (desde 1.7.0) es el manual de la memoria inteligente y el valor por defecto sigue en 1 hasta que Engines la acepte.

Todavía **no** instala MCP, instrucciones, hooks ni plugins en Claude Code, Codex o Cursor. Forge614 Engines será quien consuma el comando público y aplique el protocolo mediante el mecanismo seguro de cada asistente. Forge614 Shell mostrará una vista previa y pedirá confirmación humana. Engram no configura asistentes directamente.

PostgreSQL sigue siendo una réplica opcional, sincronizada explícitamente con `sync` o `sync-watch`; esta entrega no añade sincronización automática permanente ni una TUI.

`update --json` es una interfaz de máquina de Engram, no una señal de que Forge614 Shell ya la consuma. Shell u otro consumidor deberá comprobar e integrar ese contrato por separado. Esta interfaz está disponible desde la release estable `v1.4.0`.

Del mismo modo, `startup-context` habilita una lectura previa por hosts, pero esta rama no demuestra que Shell o Engines ya la consuman. Engram expone el contrato público de solo lectura; no configura asistentes ni les da acceso directo a SQLite.

## Modelo operativo

`forge614-engram init` permanece como un flujo pequeño de inicialización de memoria en terminal por compatibilidad. Solo pregunta sobre sincronización PostgreSQL y refuerzo de búsqueda; no configura clientes de IA. `forge614-engram init --json` es el contrato para automatización.

Forge614 Shell es la experiencia visual propia de Forge614 para instalación y ciclo de vida. Después de configurar integraciones mediante los contratos públicos correspondientes, la persona puede trabajar diariamente desde ADE Orca, Claude Code, Codex u otro entorno nativo. Shell no necesita permanecer abierto.

## Dependencias de la hoja de ruta

1. Forge614 Engines publica el contrato público de detección de motores instalados y aplicación confirmada.
2. Forge614 Shell consume ese contrato para setup guiado, vistas previas, confirmaciones, reparación y eliminación.
3. Forge614 Atlas consume Engines y el SDK público de Engram, usa `getByTopic()` para reanudar la contextualización de repositorios y escribe conocimiento estructurado validado en Engram.
4. Forge614 AI, cuando sea publicado, coordinará productos compatibles mediante el futuro comando global `forge614 init`. Engram no debe reclamar ese comando antes.

Los planes y handoffs históricos permanecen en este repositorio como registros de ingeniería. No describen la superficie pública vigente.
