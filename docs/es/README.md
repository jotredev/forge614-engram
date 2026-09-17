# Forge614 Engram — Documentación Oficial (Español)

> **Etapa:** MCP Local, Menú TUI de Asistentes, Memoria Local y Sincronización PostgreSQL Opcional
> **Versiones de esta entrega:** Programa 0.5.0 | Formato de configuración 2 (local) / 3 (con sync) | Esquema SQLite 3 (local) / 4 (con sync) / 5 (asistentes y asociaciones locales)
> **Estado:** Vigente y Verificado (191 pruebas totales en 16 archivos: 187 superadas y 4 omitidas sin binarios PG; 191 superadas, 0 fallos, 1133 aserciones con PostgreSQL aislado en macOS con Bun 1.3.8)
> **Traducción hermana:** [Official English Documentation](../en/README.md)
> **Entorno de compilación:** Bun >= 1.3.8 | TypeScript 5.9 estricto | Git (obligatorio para resolución de proyectos)
> **Ejecutable autónomo:** `forge614-engram` en `$HOME/.local/bin/` (funciona de forma autónoma sin Bun ni Node en ejecución)
> **Espacio central de usuario:** `~/.forge614/` (`.env` de configuración única y `engram.db` de base única)

---

## 1. Resumen Ejecutivo (¿Qué es en una sola frase?)

**Forge614 Engram** es un sistema de memoria personal y local que reside en la carpeta de tu usuario (`~/.forge614/`), diseñado para que tus asistentes de desarrollo (Claude Code, Codex, Cursor, OpenCode y Gemini CLI) y programas recuerden decisiones técnicas duraderas y preferencias compartidas a través de un servidor MCP nativo por stdio, con asociaciones automáticas de proyectos basadas en Git, menú interactivo en terminal (TUI), control inmutable de versiones y una réplica opcional directa con PostgreSQL sin servidores intermedios en la nube ni costos ocultos.

---

## 2. El Problema del Mundo Real que Resuelve

Cuando desarrollas software con asistentes de inteligencia artificial en tu entorno de trabajo, surgen problemas críticos de continuidad:

1. **Amnesia al reiniciar la conversación (*Context Window Reset*):** Cada nueva sesión o compactación de contexto olvida qué dependencias elegiste, qué estilo de código acordaron o qué errores ya investigaron y resolvieron.
2. **Ediciones destructivas sin rastro (*Destructive Overwrites*):** Si modificas una decisión previa, los sistemas habituales sobreescriben la nota, destruyendo el historial y la justificación técnica de por qué se cambió de criterio.
3. **Buscadores de "caja negra" (*Opaque Scoring*):** La mayoría de motores devuelven notas sin explicar qué palabras exactas coincidieron ni qué fórmula matemática justificó el orden de entrega.
4. **Fragmentación de configuración de asistentes (*Configuration Drift*):** Configurar servidores MCP y ganchos de contexto (*hooks*) a mano en cinco editores distintos genera discrepancias, archivos corruptos y filtración accidental de credenciales.
5. **Ambigüedad de proyectos y ramas (*Worktree/Subdirectory Confusion*):** Si trabajas en una subcarpeta o en un entorno de trabajo derivado de Git (*linked worktree*), los asistentes suelen considerarlo un proyecto nuevo huérfano, dispersando la memoria.
6. **Aislamiento entre múltiples computadoras (*Device Siloing*):** Al alternar entre laptop y computadora de escritorio, las notas quedan atrapadas en un solo disco sin una réplica privada que las sincronice.

Forge614 Engram resuelve esto con **una única base SQLite central local**, un servidor MCP nativo estándar, un menú interactivo en terminal con copias de respaldo seguras y verificación posterior, resolución canónica de proyectos por Git y sincronización opcional con PostgreSQL.

---

## 3. La Analogía Maestra: El Archivero Metódico, la Ventanilla MCP y el Tablero Interactivo

Imagina que contratas a un archivero muy ordenado para custodiar la memoria de todos tus proyectos de software:

- **El Gabinete Central (`~/.forge614/engram.db`):** El archivero guarda todos los papeles en un único mueble seguro en tu oficina local con permisos estrictos (`0600`). Las búsquedas y lecturas siempre se realizan en este mueble local, sin importar si hay conexión a internet.
- **La Ventanilla Estandarizada MCP (`mcp` por stdio):** En la pared de su oficina, el archivero abre una ventanilla de atención rápida con un protocolo universal de comunicación entre procesos (*Model Context Protocol* a través de la entrada y salida estándar / *stdio*). Los asistentes de desarrollo pueden acercarse a la ventanilla, identificarse y utilizar cinco herramientas exactas para consultar y registrar conocimiento duradero.
- **El Tablero de Conexión de Asistentes (`tui`):** Para conectar a tus asistentes sin errores manuales, el archivero dispone de un tablero interactivo en la terminal. Con las flechas y la barra espaciadora seleccionas tus clientes, revisas una previsualización de cambios, ejecutas una autoprueba del servidor y aplicas la configuración con copias privadas de respaldo y verificación automática de bytes.
- **El Detector de Credenciales de Proyecto (`project_bindings` y Git):** Cuando un asistente consulta desde una carpeta o desde una rama paralela (*worktree*), el archivero revisa el directorio raíz común de Git (*git common dir*). Si es la primera vez que se guarda una nota, registra la asociación local y crea el proyecto de forma atómica. Si una ruta no se puede verificar o hay ambigüedad, el archivero bloquea conservadoramente la operación para no adivinar ni mezclar proyectos.
- **La Bandeja Compartida (`scope: "shared"`):** En la parte superior del gabinete hay una bandeja para notas universales (por ejemplo: *"Prefiero explicaciones en español"*). Para colocar una nota allí, el asistente debe explicar explícitamente su intención global (`globalIntent`).
- **La Regla de la Excepción por Tema (*Topic Override*):** Si la regla general compartida dice *"Usar Bun como runtime general"*, pero tu proyecto guarda un tema activo que dice *"Usar Node.js por compatibilidad"*, el archivero entrega la excepción del proyecto y oculta la regla general en las búsquedas combinadas.
- **El Archivador Histórico de Revisiones:** Al actualizar un tema (`--topic`), el archivero nunca destruye la ficha previa: toma una fotografía de la versión previa, la anota en la tabla histórica y coloca la nueva al frente.
- **La Valija Segura de Sincronización (PostgreSQL Opcional):** Si decides habilitar una réplica en PostgreSQL, el archivero prepara una valija sellada con una instantánea completa. Al sincronizar (`sync` o `sync-watch`), compara tres estados (el último ancestro común, el local y el remoto) y combina pacíficamente los cambios independientes. Si la red se cae, el trabajo local continúa sin interrupciones.

---

## 4. Principios Fundamentales del Sistema

- **SQLite y FTS5 Siempre Locales:** PostgreSQL no sustituye a SQLite ni a su motor de búsqueda de texto completo. Todas las operaciones de guardado (`save`), consulta (`get`), búsqueda (`search`), historial (`history`) y archivo (`archive`/`restore`) se ejecutan local y síncronamente en `engram.db`.
- **Servidor MCP por stdio sin Contaminación:** El comando `mcp` reserva la salida estándar (`stdout`) exclusivamente para mensajes del protocolo JSON-RPC. No emite códigos ANSI ni mensajes informativos que puedan corromper la comunicación con el cliente de IA.
- **Cinco Herramientas MCP Nativas:** Expone `memory_current_project`, `memory_search`, `memory_get`, `memory_save` y `memory_history`. El asistente debe buscar antes de repetir investigación y guardar resúmenes duraderos antes de cerrar sesión.
- **Menú Interactivo TUI con Preflight y Respaldo:** El comando `tui` ofrece navegación con teclado, selección múltiple de asistentes, autoprueba asíncrona del servidor de 5 segundos, vista previa sin escritura, confirmación explícita, copias de seguridad `0600` con sufijo UUID y verificación posterior de bytes publicados (`PUBLISHED_UNVERIFIED` si hubo interferencia externa).
- **Detección vs Configuración vs Sesión Probada:** El sistema distingue honestamente entre un binario detectado, una configuración aplicada en disco y una sesión de cliente probada. Configurar un asistente no garantiza que esté conectado ni que el modelo llame a las herramientas; las sesiones de los clientes deben verificarse en cada aplicación.
- **Asociaciones Locales de Proyecto (`project_bindings` en Esquema 5):** Cada máquina conserva sus propias asociaciones entre carpetas locales y proyectos (`projectId`). Las ramas vinculadas (*worktrees*) y subdirectorios comparten la identidad Git común. Las rutas locales de disco jamás se sincronizan a otras máquinas.
- **Bloqueo Conservador ante Ambigüedad:** Si alguna ruta registrada de cualquier proyecto no se encuentra disponible en el disco, el sistema bloquea preventivamente la creación automática con `PROJECT_BINDING_REQUIRED` para evitar crear proyectos huérfanos o duplicados.
- **Guía de Contexto Nativa mediante Hooks:** Inyecta recordatorios de inicio de sesión y de envío de prompt en clientes compatibles (Claude Code, Codex, Cursor, OpenCode, Gemini CLI) respetando políticas y avisando de restricciones de confianza (como `/hooks` en Codex).
- **Ejecutable Autónomo sin Dependencias en Ejecución:** Compilado como binario nativo (`forge614-engram`). Una vez instalado en `$HOME/.local/bin/`, no requiere tener Bun ni Node en PATH para su uso habitual.
- **Git Obligatorio para Identidad de Proyectos:** Git es indispensable para inspeccionar repositorios y para certificar de forma segura que una carpeta no pertenece a Git; si Git no está disponible, el sistema falla cerrado con `PROJECT_IDENTITY_UNAVAILABLE`.
- **Sincronización PostgreSQL Opcional Directa:** Sin servidores Cloud intermedios. Protocolo de fusión de tres vías (*3-way merge snapshot sync*) con límite de 8 MiB y bloqueo optimista CAS. `sync-watch` se ejecuta en primer plano sin demonios.
- **Permisos Estrictos:** Directorio central `0700`, archivos `.env` y `engram.db` en `0600`. Respaldo y configuración de clientes siempre en `0600`. Se rechazan enlaces simbólicos inseguros.

---

## 5. Índice Secuencial de Documentación en Español

Para dominar Forge614 Engram paso a paso, sigue este orden de lectura:

1. [**01. Instalación, Configuración y Primeros Pasos (`01-instalacion-y-primeros-pasos.md`)**](01-instalacion-y-primeros-pasos.md): Requisitos de compilación (Bun >=1.3.8, Git obligatorio), instalación de dependencias con `bun install --frozen-lockfile --ignore-scripts`, script `install.sh`, binario autónomo, asistente interactivo `setup`, detección de asistentes y `integration-enable`.
2. [**02. Recorrido Guiado del Sistema (`02-recorrido-guiado.md`)**](02-recorrido-guiado.md): Tutorial completo: menú `tui`, autoprueba de servidor de 5s, previsualización y confirmación, vinculación de proyectos (`project-bind`), interacción MCP con asistentes de IA, ganchos nativos y réplica con PostgreSQL.
3. [**03. Manual Exhaustivo de Terminal (`03-referencia-cli.md`)**](03-referencia-cli.md): Catálogo exhaustivo comando por comando (`setup`, `tui`, `mcp`, `assistant-list`, `integration-enable`, `project-bind`, `memory-hook`, `project-create`, `project-list`, `project-rename`, `save`, `search`, `get`, `history`, `archive`, `restore`, `sync`, `sync-watch`) con parámetros, códigos de salida y formatos JSON.
4. [**04. Guía del SDK de TypeScript (`04-sdk-typescript.md`)**](04-sdk-typescript.md): Uso programático de `MemoryWorkspace` y `MemoryStore` síncronos con Esquema 5 (`enableAssistantIntegration`, `bindProjectDirectory`, `resolveProjectDirectory`, `saveForProjectDirectory`) y delimitación de módulos internos (MCP, catálogo, TUI).
5. [**05. Arquitectura Interna, Protocolo MCP y Fórmulas (`05-arquitectura-interna-y-formulas.md`)**](05-arquitectura-interna-y-formulas.md): Esquema 5 aditivo (`project_bindings`), resolución canónica de Git y worktrees, protocolo MCP (5 herramientas y Zod), adaptadores de clientes (JSONC/TOML seguros con UUID), instantáneas de 3 vías con PostgreSQL y fórmulas BM25 trigram.
6. [**06. Resolución de Problemas y Catálogo de Errores (`06-resolucion-de-errores.md`)**](06-resolucion-de-errores.md): Catálogo completo de códigos de error (`INTERACTIVE_REQUIRED`, `PROJECT_IDENTITY_UNAVAILABLE`, `PROJECT_BINDING_REQUIRED`, `PUBLISHED_UNVERIFIED`, `SYNC_CONFLICT`, `SYNC_TOO_LARGE`, etc.) con diagnósticos y procedimientos de recuperación.
7. [**07. Glosario de Conceptos en Lenguaje Cotidiano (`07-glosario.md`)**](07-glosario.md): Definiciones claras con analogías de la vida real y términos técnicos formales entre paréntesis.
8. [**08. Límites de la Etapa y Hoja de Ruta Futura (`08-limites-y-roadmap.md`)**](08-limites-y-roadmap.md): Capacidades consolidadas de las Fases 1, 2 y 3, límites vigentes (cumplimiento voluntario de modelos, pruebas sintéticas vs sesiones reales, 8 MiB) y las 2 fases pendientes en la hoja de ruta.
