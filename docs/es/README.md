# Forge614 Engram — Documentación Oficial (Español)

> **Etapa:** Etapa 1 — Memoria Local (Configuración Interactiva y Base Única)
> **Versiones de esta entrega:** Programa 0.3.0 | Formato de configuración 2 | Esquema SQLite 3
> **Estado:** Vigente y Verificado (75 pruebas superadas, 0 fallos, 563 aserciones en macOS con Bun 1.3.8)
> **Traducción hermana:** [Official English Documentation](../en/README.md)
> **Entorno de compilación:** Bun >= 1.3.8 | SQLite (`bun:sqlite` con FTS5 trigram) | TypeScript 5.9 estricto
> **Ejecutable autónomo:** `forge614-engram` en `$HOME/.local/bin/` (no requiere Bun en ejecución diaria)
> **Espacio central de usuario:** `~/.forge614/` (`.env` de configuración única y `engram.db` de base única)

---

## 1. Resumen Ejecutivo (¿Qué es en una sola frase?)

**Forge614 Engram** es una libreta de memoria personal que vive dentro de la carpeta de tu usuario (`~/.forge614/`), creada para que tus asistentes de inteligencia artificial y programas recuerden decisiones de proyectos y preferencias generales compartidas a lo largo del tiempo, manteniendo un historial inmutable de versiones y un buscador explicable basado en SQLite FTS5 sin costo de tokens ni llamadas a la nube.

---

## 2. El Problema del Mundo Real que Resuelve

Cuando interactúas con asistentes de inteligencia artificial o programas de asistencia técnica, surgen cuatro problemas habituales:

1. **Amnesia al reiniciar la conversación (*Context Window Reset*):** Cada nueva sesión olvida qué base de datos elegiste, qué estilo de código prefieres o qué advertencias acordaron.
2. **Ediciones destructivas sin rastro (*Destructive Overwrites*):** Si modificas una decisión técnica importante, los sistemas convencionales sobreescriben la nota anterior, perdiendo la justificación de por qué se cambió de criterio.
3. **Buscadores de "caja negra" (*Opaque Scoring*):** La mayoría de motores devuelven notas sin explicar por qué eligieron ese resultado ni qué palabras exactas coincidieron.
4. **Duplicación de preferencias universales (*Preference Fragmentation*):** Si tienes una preferencia general (por ejemplo, *"Prefiero explicaciones en español"* o *"Usar Bun como runtime"*), tenías que repetirla en cada proyecto por separado.

Forge614 Engram resuelve esto con **una única base de datos y un único archivo de configuración** para todos tus proyectos, distinguiendo entre recuerdos propios de un proyecto y recuerdos compartidos universales, con un sistema matemático transparente de búsqueda y control estricto de revisiones.

---

## 3. La Analogía Maestra: El Archivero Metódico con Fichero Universal

Imagina que contratas a un archivero muy ordenado para gestionar la memoria de todo tu trabajo:

- **El Gabinete Central (`~/.forge614/engram.db`):** El archivero guarda todos los papeles en un único mueble seguro en tu oficina. No abre muebles separados ni carpetas dispersas por el disco.
- **Las Gavetas de Proyecto (`projectId`):** Cada proyecto registrado recibe una credencial fija e inmutable (un identificador único `projectId`). Sus recuerdos privados van dentro de su gaveta y jamás se mezclan con los recuerdos de otros proyectos.
- **La Bandeja Compartida (`scope: "shared"`):** En la parte superior del gabinete hay una bandeja para notas universales (por ejemplo: *"Prefiero explicaciones en español"*). Esta nota se escribe una sola vez y sirve de guía para todos los proyectos sin duplicar papel.
- **La Regla de la Excepción por Tema (*Topic Override*):** Si la regla general de la empresa dice *"Usar Bun como preferencia general"*, pero tu proyecto específico guarda una nota activa con el mismo tema que dice *"Usar Node.js por compatibilidad con este proyecto"*, el archivero entrega la excepción de tu proyecto y oculta la regla general. Si más tarde archivas la excepción del proyecto, la regla compartida vuelve a ser visible automáticamente.
- **El Archivador Histórico de Revisiones:** Al actualizar un tema (`--topic`), el archivero nunca destruye la ficha previa: le toma una copia fotográfica, la guarda en el registro histórico inmutable y coloca la versión más reciente al frente.
- **El Sello de Seguridad contra Duplicados (Idempotencia):** Si tu mensajero intenta entregarle dos veces la misma nota con la misma clave de envío (`--request-key`), el archivero verifica el sello y devuelve la nota existente sin crear duplicados.
- **El Índice Trigram y la Pizarra Matemática:** Al buscar, el archivero consulta un índice rápido de fragmentos de tres letras y te entrega las notas coincidentes, escribiendo en la pizarra la fórmula matemática exacta (BM25, prioridad fijada y frescura temporal) que justifica el orden de entrega.

---

## 4. Principios Fundamentales del Sistema

- **Una Configuración y Una Base de Datos Central:** Todo el sistema se aloja en `~/.forge614/` bajo un único archivo de configuración privada (`.env`) y una única base SQLite (`engram.db`), independientemente de la carpeta desde donde ejecutes la terminal.
- **Identidad Estable de Proyecto (`projectId`):** Los proyectos se registran en la tabla `projects` con un identificador único (UUIDv4 en minúsculas). El nombre visible es puramente una etiqueta descriptiva; cambiar el nombre jamás altera la identidad ni pierde el acceso a sus recuerdos.
- **Dos Alcances de Memoria (`scope`):**
  - `project`: Recuerdos privados y específicos de un proyecto (requiere `--project-id`).
  - `shared`: Recuerdos y preferencias generales que aplican a todos los proyectos (se guarda una sola vez con `projectId` nulo).
- **Búsqueda Combinada Inteligente con Excepciones:** Buscar desde un proyecto (`search --project-id <UUID>`) incluye por defecto sus recuerdos relevantes y los compartidos (`--scope all`). Si un proyecto define un tema con el mismo `topicKey` que una regla compartida, la decisión del proyecto sustituye a la general en ese proyecto.
- **100% Local, Privado y con Cero Costo de Red:** No requiere claves de internet (API keys), no envía datos a servidores externos, no consume tokens de modelos de lenguaje en esta etapa y no tiene telemetría.
- **Ejecutable Binario Autónomo:** Compilado como binario nativo (`forge614-engram`) en `$HOME/.local/bin/`. No requiere tener Bun ni Node en PATH para utilizarse en el día a día.
- **Seguridad y Permisos Estrictos:** Carpeta de usuario en modo `0700` y archivos en modo `0600`. Se rechazan enlaces simbólicos, enlaces duros y propietarios ajenos antes de abrir SQLite.
- **Sin Borrado Destructivo:** Las notas obsoletas se archivan (`archive`) para retirarlas de las búsquedas normales, pero permanecen íntegras en el historial para auditoría o restauración (`restore`).
- **Operación Manual/Programática en Etapa 1:** El sistema guarda cuando se le ordena (`save`). La integración automática mediante `memory_save` con asistentes de IA está planificada para etapas posteriores.

---

## 5. Índice Secuencial de Documentación en Español

Para aprender a utilizar y dominar Forge614 Engram, sigue esta secuencia cronológica de lectura:

1. [**01. Instalación, Configuración y Primeros Pasos (`01-instalacion-y-primeros-pasos.md`)**](01-instalacion-y-primeros-pasos.md): Compilación con Bun, instalación en PATH, asistente interactivo `setup` con confirmación única, comando programático `init`, creación de tu primer proyecto y primeros recuerdos.
2. [**02. Recorrido Guiado del Sistema (`02-recorrido-guiado.md`)**](02-recorrido-guiado.md): Tutorial paso a paso del ciclo de vida completo: configuración interactiva (`setup`), creación de proyectos, guardado, búsqueda combinada, sustitución por tema (*topic override*), auditoría y archivo.
3. [**03. Manual Exhaustivo de Terminal (`03-referencia-cli.md`)**](03-referencia-cli.md): Catálogo completo comando por comando (`setup`, `init`, `project-create`, `project-list`, `project-rename`, `save`, `search`, `get`, `history`, `archive`, `restore`) con opciones exactas, códigos de salida y salidas en texto/JSON.
4. [**04. Guía del SDK de TypeScript (`04-sdk-typescript.md`)**](04-sdk-typescript.md): Integración mediante `MemoryWorkspace`, `runSetup`, `WorkspaceConfig` y `MemoryStore` con ejemplos prácticos ejecutables.
5. [**05. Arquitectura Interna, SQLite FTS5 y Fórmulas (`05-arquitectura-interna-y-formulas.md`)**](05-arquitectura-interna-y-formulas.md): Esquema relacional v3, inicialización WAL, disparadores automáticos, tokenizador trigram, desglose matemático de BM25, recencia y consulta SQL de sustitución por tema.
6. [**06. Resolución de Problemas y Catálogo de Errores (`06-resolucion-de-errores.md`)**](06-resolucion-de-errores.md): Tabla completa con todos los códigos de error (`INTERACTIVE_REQUIRED`, `CONFIG_INVALID`, `LEGACY_CONFIG`, `MIGRATION_REQUIRED`, `DATABASE_MISSING`, `PROJECT_NOT_FOUND`, etc.) y sus soluciones directas.
7. [**07. Glosario de Conceptos en Lenguaje Cotidiano (`07-glosario.md`)**](07-glosario.md): Términos técnicos explicados de manera sencilla y cotidiana con su término formal entre paréntesis.
8. [**08. Límites de la Etapa y Hoja de Ruta Futura (`08-limites-y-roadmap.md`)**](08-limites-y-roadmap.md): Capacidades implementadas en esta entrega, límites vigentes, política aprobada para la integración futura con asistentes, y la hoja de ruta oficial de 4 fases pendientes.
