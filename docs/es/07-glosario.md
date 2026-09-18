# 07. Glosario de Conceptos en Lenguaje Cotidiano

> **Etapa:** Centro de Control TUI, FTS5 Reforzado (sin embeddings), Monolito Modular por Funcionalidad, Sesiones Progresivas de Memoria, Contexto Clasificado, MCP Local (10 Herramientas), Menú TUI de Asistentes y Réplica PostgreSQL Formatos 1, 2 y 3
> **Versiones de esta entrega:** Programa 0.5.0 | Formatos de configuración 2 (local) / 3 (con sync) | Esquemas SQLite 3 (local) / 4 (con sync) / 5 (asistentes y asociaciones locales) / 6 (sesiones progresivas y contexto clasificado) / 7 (confirmaciones inmutables y refuerzo de búsqueda) | Formatos PostgreSQL 1, 2 y 3
> **Estado:** Vigente y Activo (504 pruebas totales en 82 archivos: 495 superadas y 9 omitidas sin binarios aislados PG; 504 superadas, 0 fallos, 2566 aserciones con `FORGE614_TEST_POSTGRES_BIN` configurado en macOS con Bun 1.3.8 en 39.76s)
> **Traducción hermana:** [07 (EN). Plain-Language Glossary](../en/07-glossary.md)

Este glosario explica cada concepto técnico utilizando analogías y metáforas de la vida cotidiana, seguidas inmediatamente de su término técnico formal entre paréntesis.

---

### Centro de Control TUI (TUI Control Center / `controlCenterTui` / `forge614-engram tui`)
Como un panel de instrumentos de supervisión general en la sala de control de una central: una interfaz interactiva de consola a pantalla completa que centraliza la visualización de proyectos, carpetas vinculadas, memorias compartidas globales, estado de almacenamiento SQLite y PostgreSQL, y ejecución deliberada de acciones administrativas sin necesidad de recordar comandos CLI individuales.

### Lectura por Defecto (Read-Only by Default)
Como un museo con vitrinas donde puedes observar y estudiar cada pieza sin peligro de alterarlas: una regla arquitectónica donde abrir el Centro de Control TUI, navegar entre pestañas, consultar proyectos o redimensionar la ventana opera en modo de estricta solo lectura, garantizando que ninguna consulta o exploración altere un solo byte de la base de datos o de los archivos de configuración.

### Confirmación de Dos Pasos (Two-Step Action Confirmation / `confirm` + Enter)
Como una caja de seguridad con llave protegida y botón de confirmación deliberada: un protocolo de seguridad interactivo donde ninguna acción de escritura (crear proyectos, vincular carpetas, aplicar migraciones o sincronizar) puede ejecutarse presionando simplemente `Enter`. Requiere que el operador visualice la previsualización del impacto, escriba deliberadamente la palabra `confirm` (o `CONFIRM`) en un cuadro de texto y presione `Enter`.

### Saneamiento de Salida de Terminal (Terminal Output Sanitization / `sanitizeTerminalOutput`)
Como un filtro purificador que retira impurezas del aire antes de entrar a un quirófano: una rutina de limpieza de cadenas que analiza nombres de proyectos, rutas y textos externos, suprimiendo secuencias de escape ANSI, caracteres de control no imprimibles, marcadores de anulación bidireccional (bidi overrides), caracteres de ancho cero y enlaces URL para blindar la terminal contra inyecciones maliciosas o distorsiones visuales.

### Subflujo Secuencial de Terminal (Sequential Terminal Subflow)
Como pausar una llamada telefónica para atender brevemente otra línea y luego reanudar la llamada original exactamente donde se quedó: la técnica donde el Centro de Control pausa su propio bucle de eventos, restaura de forma limpia la terminal estándar, invoca el asistente de integración (`assistantTui`) en un subproceso secuencial y, al finalizar este, recarga una instantánea fresca del sistema y reactiva el Centro de Control sin anidar modos crudos (*raw mode*) concurrentes.

### Ocultación Estricta de Secretos y Privacidad (Strict Secret Concealment)
Como un informe financiero ejecutivo que resume cifras clave sin revelar las claves de acceso de las cuentas bancarias: el principio de privacidad por el cual el Centro de Control TUI jamás muestra contraseñas, URLs de conexión a PostgreSQL (`POSTGRES_URL`), contenidos íntegros de `.env`, ni el texto o títulos de los recuerdos de los proyectos, limitándose a métricas agregadas y metadatos estructurales.

---


### Confirmación Inmutable de Recuerdo (Immutable Memory Confirmation / `Confirmation` / `confirmations`)
Como poner una muesca de lápiz en la portada de un manual cada vez que lo vuelves a consultar en el taller, sin arrancar hojas ni reimprimir el libro entero: un evento histórico fechado e inmutable que registra que un recuerdo activo existente fue observado nuevamente por el asistente, sin fabricar versiones 2 o 3 artificiales ni duplicar el contenido. Representa una nueva observación del dato; no certifica verdad absoluta ni verificación humana.

### Refuerzo de Búsqueda FTS5 sin Embeddings (FTS5 Reinforced Search without Embeddings)
Como un bibliotecario experto que organiza los libros en el mostrador dando preferencia a los que consulta con frecuencia y a los que se han revisado recientemente, sin necesidad de escanearlos con rayos X ni usar complejos modelos neuronales: un mecanismo de ordenación matemática que pondera las coincidencias léxicas de BM25 multiplicándolas por factores de notas fijadas (`pinned`), actualidad temporal en escala de 30 días (`recencyBoost`), y estabilidad acumulada (`stabilityBoost`).

### Ventana Móvil de Deduplicación de 15 Minutos (15-Minute Sliding Deduplication Window)
Como recordar lo que te dijeron hace diez minutos en la misma conversación sin confundirlo con lo que te contaron el mes pasado: una regla temporal estricta para notas generales sin tema (`topicKey: null`), donde solo se consideran duplicados los datos observados en los últimos 15 minutos exactos (`now - 900,000 ms` a `now`). Si transcurren más de 15 minutos, Engram crea un recuerdo independiente nuevo para no fusionar hechos distantes.

### Reintento Idempotente por Clave de Petición (Idempotent Request Key Replay / `requestKey` / `Replay`)
Como presentar el mismo boleto sellado en la taquilla tras cortarse la luz: si una operación de guardado se interrumpe y se reintenta con la misma clave y el mismo contenido (mismo hash criptográfico SHA-256), el sistema devuelve inmediatamente la respuesta almacenada previamente sin alterar versiones ni añadir confirmaciones redundantes.

### Conflicto de Carga en Reintento (Request Payload Conflict / `REQUEST_CONFLICT`)
Como intentar cobrar un cheque ya emitido pero con una cantidad o beneficiario cambiado con bolígrafo: un error de seguridad que aborta inmediatamente la operación cuando se detecta que una misma clave de petición (`requestKey`) se intenta reutilizar con un contenido, título o alcance diferente al original.

### Sesgo o Desfase de Reloj Local (System Clock Skew / `CLOCK_SKEW`)
Como mirar un reloj de pared atrasado que pretende marcar las 2:00 de la tarde cuando ya sellaste un recibo a las 3:00: una salvaguarda de seguridad cronológica que rechaza una confirmación cuando el reloj del sistema local marca una fecha anterior a la fecha registrada en la versión del recuerdo que se pretende confirmar.

### Saturación Asintótica de Estabilidad (Asymptotic Stability Saturation / $\frac{n}{n+4}$)
Como un estudiante que adquiere confianza en un tema repasándolo: las primeras veces que repasa el impacto en su aprendizaje es muy notable, pero después de muchas repeticiones el beneficio adicional se estabiliza suavemente sin crecer descontroladamente hasta el infinito. En Engram, el impulso de estabilidad empieza en 0.00, llega a la mitad (0.02) con 4 observaciones acumuladas y converge a un tope máximo de 0.04.

### Promoción a Formato 3 de Réplica (PostgreSQL Replica Format 3 Promotion / `sync --upgrade-format`)
Como habilitar una nueva sección de archivos en una bóveda bancaria compartida: un procedimiento deliberado mediante el comando `sync --upgrade-format` que actualiza la réplica remota para transferir confirmaciones inmutables y peticiones idempotentes, manteniendo la tabla física de PostgreSQL invariable (`state.format = 1`) y protegiendo a los clientes pares que aún no hayan habilitado el Esquema 7 (`REINFORCEMENT_REQUIRED`).

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

---

### Monolito Modular por Funcionalidad (Feature-Oriented Modular Monolith)
Como una caja de herramientas profesional donde cada compartimento tiene una función clara y ordenada, pero todo viaja en un único maletín portátil: un diseño de software que compila un único programa ejecutable autónomo para tu sistema operativo, organizando su código interno por conceptos del mundo real (`memory`, `sessions`, `projects`, `search`) con fronteras claras y puertas de entrada explícitas (`index.ts`), sin dispersarse en servicios remotos de red.

### Fachada Compatible (Compatible Facade Pattern / `MemoryStore`)
Como el mostrador de recepción de un hotel elegante: una cara visible amigable y familiar que atiende a los clientes exactamente como siempre lo ha hecho, mientras detrás del mostrador un equipo de especialistas coordina las tareas sin que el cliente tenga que aprender un protocolo nuevo ni cambiar su forma de interactuar.

### Auditor AST de Arquitectura (Abstract Syntax Tree Architecture Auditor / `import-rules`)
Como un inspector aduanero infatigable que revisa el equipaje de cada paquete antes de permitirle la entrada: una herramienta automática de análisis de código fuente basada en el compilador de TypeScript que rastrea todos los `import` del proyecto, detecta si alguna capa intenta comunicarse con quien no debe y evita la formación de callejones sin salida o bucles infinitos (*cycles*).

### Pruebas Colocadas Hermanas (Colocated Sibling Tests / `<archivo>.test.ts`)
Como tener el extintor de incendios exactamente al lado de la máquina que podría calentarse, en lugar de guardarlo en una bodega lejana al final del pasillo: la práctica de colocar el archivo de pruebas unitarias directamente junto al archivo de código fuente que implementa esa lógica (ej. `memory.test.ts` junto a `memory.ts`), garantizando que cada pieza tenga un responsable inmediato de calidad.

### Transacción Exterior Compuesta (Composite Outer Transaction / `writes.ts`)
Como firmar una escritura notarial donde o se completan todos los sellos, firmas y pagos al mismo tiempo, o el trámite se cancela por completo sin dejar documentos a medias: una operación indivisible de base de datos (`BEGIN IMMEDIATE ... COMMIT`) donde se registran el proyecto, la nota, su versión inmutable, el evento histórico, el hash de solicitud idempotente y la entrada de sesión en un solo parpadeo seguro.

### Bloqueo Optimista CAS (Compare-and-Swap / CAS)
Como dos personas que intentan sellar el mismo documento numerado: cada una revisa primero qué número tiene el sello actual; la primera que llega estampa el nuevo sello avanzando la numeración, mientras que la segunda, al notar que el número ya no coincide con el que vio, se detiene amablemente sin arruinar el trabajo de la primera.
