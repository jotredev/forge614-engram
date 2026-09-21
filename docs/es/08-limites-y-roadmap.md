# 08. Límites Vigentes y Hoja de Ruta

## Límite actual del producto

Forge614 Engram es el motor de memoria persistente del ecosistema Forge614. Es dueño de una base SQLite/FTS5 local, identidades de proyecto, recuerdos compartidos, sesiones, búsqueda, su servidor MCP por `stdio` y su SDK público de TypeScript.

Intencionalmente **no** es un espacio visual, detector de asistentes, configurador de asistentes, administrador de hooks ni cliente de chat. Esas responsabilidades pertenecen a Forge614 Shell y Forge614 Engines mediante contratos públicos.

## Capacidades disponibles en v1.2.1

- Hogar privado en `~/.forge614/engram/` con `engram.db`, `.env` y `bin/`.
- SQLite y FTS5 locales para todos los proyectos y recuerdos compartidos. La búsqueda local funciona sin red.
- Réplica opcional PostgreSQL configurada de forma no interactiva con `init --json --postgres-url <URL>`.
- Recuerdos por proyecto y compartidos, consulta exacta por tema, historial, archivo/restauración, búsqueda FTS5, vistas previas, contexto, sesiones y refuerzo.
- Servidor MCP local por `stdio`, iniciado con `forge614-engram mcp`.
- SDK público para consumidores como Forge614 Atlas, incluyendo `MemoryWorkspace`, `MemoryStore`, APIs de inicialización y `MemoryStore.getByTopic()`.
- Instalación, actualización y desinstalación seguras. `forge614-engram update` instala el último release estable después de verificar su checksum.

## No objetivos explícitos

- No hay TUI ni centro de control de terminal en Engram.
- No hay detección de IA instalada, selección de clientes, hooks, plugins ni escrituras de configuración MCP.
- No existe catálogo de adaptadores de OpenCode, Antigravity, Cursor, Claude Code, Codex o Gemini en este producto.
- Aún no hay release ni instalador de Windows. Los binarios oficiales actuales son para macOS y Linux.
- No hay embeddings ni búsqueda exclusiva en nube. FTS5 y SQLite siguen siendo la ruta local primaria.
- La inicialización no crea ni selecciona proyectos automáticamente.

## Protocolo público de memoria: estado de integración

El contrato `forge614-engram-memory` versión `1` está disponible desde la release `v1.3.0` y se puede inspeccionar con `forge614-engram memory-protocol --json`. Su publicación no significa que una integración de asistentes ya esté instalada.

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
