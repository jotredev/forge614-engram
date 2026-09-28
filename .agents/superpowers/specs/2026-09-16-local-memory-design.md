# Diseño aprobado: memoria personal local

## Objetivo y alcance

Construir por pasos un sistema propio en TypeScript y Bun, inspirado en Engram
de Gentleman y Softmax. Servirá a asistentes por MCP y a aplicaciones mediante
SDK y HTTP local. El usuario aprobó el diseño conversacional y pidió documentación
detallada en español e inglés, separada en `docs/es/` y `docs/en/`, y publicada
también en Notion. Lenguaje sencillo primero, término técnico entre paréntesis.
El usuario delega documentación y Notion a otro modelo. Este agente implementa
y entrega un prompt documental por etapa con evidencia, ejemplos y límites;
no publica en Notion ni redacta las guías bilingües en esta sesión.

La primera entrega implementa el almacenamiento y la búsqueda textual junto con
una herramienta de terminal y una interfaz TypeScript. Las siguientes entregas
añaden sesiones/MCP/HTTP, recuperación semántica y evolución controlada. Cada
entrega debe ser utilizable, comprobada y documentada antes de avanzar.

## Decisiones de la primera entrega

- Nombre de trabajo: Forge614 Engram, sin implicar afiliación con los originales.
- Bun >=1.3.8, TypeScript estricto, SQLite local con FTS5 y tokenizador trigram.
- Base por defecto: `~/.forge614/engram.db`, en la carpeta del usuario, independiente
  del directorio de ejecución. CLI y SDK comparten `defaultDatabasePath()`.
  Una ruta explícita sigue disponible para pruebas o uso avanzado; no se exploran
  ni migran bases ajenas o anteriores automáticamente.
- Proyecto explícito y obligatorio; espacios exteriores eliminados, minúsculas.
  No inferir identidad a partir de carpetas o remotos todavía.
- Una memoria tiene UUID, título, contenido, tipo, tema opcional, prioridad,
  estado, versión y fechas UTC. Tipos: fact, decision, procedure, warning, preference.
- El tema es único por proyecto. Guardarlo por primera vez crea versión 1;
  cambiarlo exige indicar la versión leída (expectedVersion).
- Cada modificación preserva una versión completa. Archivar/restaurar mantiene
  el contenido y escribe un evento; no borra historia ni reutiliza temas.
- Clave de petición opcional: repetir la misma petición devuelve su versión
  original, sin volver a escribir. Reusar la clave con otro contenido falla.
- Guardar texto idéntico sin tema ni clave puede crear recuerdos distintos:
  todavía no hay fusión semántica ni deduplicación automática por contenido.
- Transacciones IMMEDIATE para arbitrar escritores entre procesos; WAL,
  foreign_keys y busy_timeout. No se mantienen transacciones durante llamadas IA.
- FTS5 pondera título 5, contenido 1 y tema 3. Bonificación máxima de prioridad
  0.10 y recencia 0.06, con recencia 1/(1+días/30). Sin bonificación por repetición.
- Consultas literales, todas las palabras deben coincidir. Si una palabra tiene
  menos de tres caracteres, recorrer solo el proyecto con comparación literal
  en minúsculas Unicode y orden temporal explícito. LIKE se descartó porque
  SQLite solo ignora mayúsculas ASCII y rompe consultas como «UI árbol».
- Resultados excluyen archivadas, respetan proyecto, límite 1..100 y entregan
  explicación del modo y puntuación. No se presentan puntuaciones como verdad.
- Obtener, historial, archivo y restauración requieren proyecto además del UUID.
- CLI emite JSON en español para errores; no imprime contenidos al fallar.
- Ninguna llamada a modelos, telemetría, nube, pago ni cambio de configuración global.

## Tablas y coherencia

`memories` guarda la versión vigente; `memory_versions` conserva revisiones;
`events` registra acciones; `requests` registra claves y respuestas originales.
Un índice FTS5 externo refleja el texto mediante disparadores (triggers).
Guardar versión, estado actual, historial e idempotencia sucede en una transacción.
El historial contiene snapshots del contenido; el estado actual se consulta aparte.

## Validación de entrega 1

Pruebas sobre SQLite real: persistencia tras reapertura, aislamiento por proyecto,
historial, actualización del índice, conflicto de revisión, reintentos incluso tras
una revisión posterior, archivo/restauración y términos cortos/literales.
Dos conexiones al mismo archivo deben rechazar escrituras con versiones obsoletas.
La CLI debe guardar y recuperar datos entre procesos y rechazar argumentos erróneos
antes de crear una base. Comandos: `bun test`, `bun run typecheck`.

## Entregas posteriores y límites

### Aclaraciones del usuario después de revisar documentación

El programa debe instalarse desde el repositorio y ofrecer el comando
`forge614-engram`, sin publicación ni instalación desde npm. El instalador
`scripts/install.sh` compila un ejecutable autónomo con Bun >=1.3.8 y lo copia
a `$HOME/.local/bin` o a `--bin-dir`. Bun es necesario al compilar, no al ejecutar
el binario. `--force` autoriza reemplazar el ejecutable existente; no toca bases.
La ayuda pública usa el nombre del comando; `bun run cli` queda para desarrollo.

El guardado cotidiano esperado es de decisiones y aprendizajes importantes,
iniciado por el asistente durante el trabajo, no captura de conversaciones
completas ni escritura manual obligatoria. Esto sigue pendiente de conectar
mediante MCP y un protocolo de uso. Instalar MCP por sí solo no garantiza que
un asistente utilice la memoria. Se deberán probar guardado, recuperación,
correcciones y continuidad por cliente compatible.

«Aprender» significa mejorar la selección y vigencia del conocimiento mediante
feedback por memoria, procedencia, revisiones y conflictos; no entrenar el modelo.
La superioridad frente a los repositorios de referencia se evalúa con un corpus
común y métricas, no se presume por agregar funciones.

El usuario normal no instancia MemoryStore ni configura un servidor de base de
datos. La CLI abre/crea el archivo automáticamente al usar un comando válido.
`new MemoryStore()` abre la misma base del usuario; pasar una ruta explícita
elige otro archivo. Ambos pertenecen únicamente a la integración programática.

Sesiones, MCP y HTTP local reutilizarán el núcleo. Embeddings locales generarán
candidatos independientes y se fusionarán por RRF; MMR limitará redundancia.
El presupuesto incluirá metadatos. Feedback será por memoria/version, sin atribuir
éxito de tarea a todos los recuerdos. No habrá purga automática.

Fuera del primer ciclo: nube, multiusuario, panel, sincronización distribuida,
entrenamiento, migraciones de bases originales y publicación de paquetes.
El modelo local se elegirá después de evaluar hardware, licencia e idiomas.

## Riesgos

La búsqueda literal no comprende paráfrasis. Trigram necesita fallback para términos
cortos; esa ruta puede recorrer todo el proyecto y ser más lenta. SQLite
serializa escrituras y puede dar ocupado tras cinco segundos.
La base y sus archivos auxiliares contienen texto sin cifrar; no guardar secretos.
No copiar solo el archivo principal con escritores activos. La copia segura se
documentará junto con una futura operación de exportación comprobada.
