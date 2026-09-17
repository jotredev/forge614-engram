# 07. Glosario de Conceptos en Lenguaje Cotidiano

> **Etapa:** Sesiones Progresivas de Memoria, Contexto Clasificado, MCP Local (10 Herramientas), Menú TUI de Asistentes y Réplica PostgreSQL Formato 2
> **Versiones de esta entrega:** Programa 0.5.0 | Formatos de configuración 2 (local) / 3 (con sync) | Esquemas SQLite 3 (local) / 4 (con sync) / 5 (asistentes y asociaciones locales) / 6 (sesiones progresivas y contexto clasificado) | Formatos PostgreSQL 1 y 2
> **Estado:** Vigente y Activo (Verificado con 250 pruebas en 18 archivos en macOS con Bun 1.3.8)
> **Traducción hermana:** [07 (EN). Plain-Language Glossary](../en/07-glossary.md)

Este glosario explica cada concepto técnico utilizando analogías y metáforas de la vida cotidiana, seguidas inmediatamente de su término técnico formal entre paréntesis.

---

### Sesión Progresiva de Trabajo (Progressive Memory Session / `Session`)
Como una jornada de trabajo en un taller artesanal: un período delimitado de concentración donde un desarrollador o un asistente de inteligencia artificial colaboran en una tarea específica dentro de un proyecto, registrando qué decisiones se tomaron en cada momento.

### Sesión en Ejecución (Runtime Session / `kind: "runtime"`)
Como encender y apagar el cronómetro de un proyecto: una sesión iniciada intencionadamente mediante `session-start` que registra la fecha y hora de inicio (`startedAt`), la carpeta de trabajo y permanece activa hasta que se concluye formalmente con `session-end` (`endedAt`).

### Sesión Manual de Respaldo (Manual Fallback Session / `kind: "manual"` / `local_manual_sessions`)
Como un bloc de notas comodín en el escritorio: una sesión local fija y permanente que existe en tu computadora para cada proyecto. Si guardas un recuerdo desde la terminal sin especificar ninguna sesión activa, Engram lo anota automáticamente en este bloc de respaldo para que jamás se pierda su contexto.

### Línea Temporal de Sucesos (Session Timeline / `timeline` / `memory_timeline`)
Como revisar las fotografías del carrete tomadas antes y después de una foto principal: una herramienta que te sitúa sobre un recuerdo particular (`focus`) y te muestra cronológicamente las notas que se registraron inmediatamente antes (`before`) y después (`after`) dentro de esa misma sesión de trabajo.

### Contexto Clasificado por Secciones (Ranked Context / `context` / `memory_context`)
Como una carpeta ejecutiva perfectamente tabulada para entrar a una junta importante: un informe sintetizado que agrupa tus recuerdos en tres compartimentos esenciales: notas fijadas imprescindibles (`pinned`), acuerdos recientes de trabajo (`recent`) y bitácoras de sesiones anteriores (`summaries`).

### Previsualización Ligera o Ficha Abreviada (Memory Preview / `MemoryPreview`)
Como leer el titular y el primer párrafo de una noticia antes de decidir si compras el periódico: una versión compacta de un recuerdo cuyo texto se recorta a un máximo de **300 puntos de código Unicode** (*code points*) con una etiqueta que indica si fue abreviado (`truncated: true`). Permite al modelo hojear decenas de notas sin saturar su memoria operativa.

### Presupuesto Estricto de Serialización (`maxBytes`)
Como el peso máximo autorizado para el equipaje de mano en un avión: un límite numérico estricto (entre 1024 y 65536 bytes) que mide **el peso exacto en bytes UTF-8 del mensaje JSON final que se transmite**. **No es un presupuesto de tokens de inteligencia artificial**, sino un límite físico de transporte de red y proceso.

### Resumen Estructurado de Sesión (Structured Session Summary / `session-summary`)
Como el acta oficial de cierre de una obra: un documento estandarizado que contiene exactamente seis apartados obligatorios: qué se quería lograr (`goal`), directrices clave (`instructions`), lecciones aprendidas (`discoveries`), logros completados (`accomplishments`), tareas pendientes (`nextSteps`) y los archivos modificados (`files`). Se almacena bajo el tema reservado inmutable `session/<id>/summary`.

### Inferencia de Sesión (Session Inference)
Como un asistente atento que sabe en qué asunto estás trabajando: cuando un modelo de IA guarda una nota sin indicar sesión, Engram revisa si existe exactamente una única sesión abierta en los últimos 7 días en esa carpeta. Si la encuentra, asocia la nota a ella de forma inteligente (`sessionSource: "inferred"`). Si hay dos o más abiertas, se detiene y te pregunta para no equivocarse (`AMBIGUOUS_SESSION`).

### Promoción Atómica de Formato de Réplica (Format 2 Promotion / `sync --upgrade-format`)
Como remodelar una carretera añadiendo nuevos carriles sin detener el tráfico: un procedimiento consciente y protegido por cerrojos optimistas atómicos (CAS) que actualiza una réplica en la nube desde el Formato 1 clásico al Formato 2 moderno (habilitando la sincronización de sesiones y resúmenes). Requiere ejecutarse deliberadamente con una ronda única de `sync --upgrade-format`.

### Conflicto de Plugin en OpenCode (`CONFLICT`)
Como encontrarte con una cerradura cambiada que prefieres no forzar: una salvaguarda de seguridad mediante la cual Engram, al detectar que el archivo de plugin `plugins/forge614-engram.js` ya existe con modificaciones previas, se detiene en seco y no lo sobrescribe. Permite al usuario respaldar y conciliar su código manualmente.

### Protocolo de Contexto de Modelo (Model Context Protocol / MCP)
Estándar abierto de comunicación que permite a los modelos de IA interactuar uniformemente con herramientas de memoria. En Forge614 Engram expone 10 herramientas nativas locales a través de los canales estándar del sistema (`stdio`).

### Menú Interactivo en Terminal (Terminal User Interface / TUI / `tui`)
Panel visual interactivo a pantalla completa dentro de la consola de comandos donde una persona puede seleccionar opciones con las flechas del teclado y la barra espaciadora, previsualizar cambios, ejecutar autopruebas y confirmar configuraciones.

### Autoprueba del Servidor MCP (MCP Server Self-Test)
Prueba automatizada y asíncrona que el menú TUI ejecuta sobre el ejecutable binario instalado en tu máquina, comprobando que responda en menos de 5 segundos y exponga las 10 herramientas de memoria oficiales.

### Vinculación o Asociación Local de Proyecto (Project Binding / `project_bindings`)
Registro en la base de datos local que asocia una ruta física de carpeta en el disco de este equipo con un identificador de proyecto (`projectId`). Es exclusivo de cada computadora y jamás se sincroniza a través de la red hacia otras máquinas.

### Directorio Raíz Común de Git (Git Common Directory / `--git-common-dir`)
Ubicación canónica del repositorio Git principal que permite a múltiples subcarpetas y entornos de trabajo vinculados (*linked worktrees*) compartir exactamente la misma identidad y recuerdos sin duplicaciones.

### Algoritmo BM25 y Multiplicador de Recencia
Fórmula matemática (*Best Matching 25*) que calcula la relevancia de búsqueda combinando la frecuencia de palabras clave, la prioridad manual (`pinned`) y la frescura temporal de la nota mediante un decaimiento progresivo.
