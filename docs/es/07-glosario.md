# 07. Glosario de Conceptos en Lenguaje Cotidiano

> **Etapa:** Memoria Local y Sincronización PostgreSQL Opcional
> **Versiones de esta entrega:** Programa 0.4.0 | Formato de configuración 2 (local) / 3 (con sync) | Esquema SQLite 3 (local) / 4 (con sync)
> **Estado:** Vigente y Activo (Verificado con 90 pruebas en macOS con Bun 1.3.8)
> **Traducción hermana:** [07 (EN). Plain-Language Glossary](../en/07-glossary.md)

Este glosario explica cada concepto técnico utilizando analogías y lenguaje de la vida cotidiana, seguido de su término técnico formal entre paréntesis.

---

### Asistente interactivo guiado (Interactive Setup Wizard / `setup`)
Comando para personas que explica las rutas del sistema, comprueba compatibilidad en modo de solo lectura, ofrece configurar la sincronización opcional con PostgreSQL y pide una confirmación antes de crear o actualizar el almacenamiento global, sin preguntar, crear ni seleccionar proyectos.

### Terminal interactiva con soporte de teclado (Interactive TTY / `isTTY`)
Canal de consola interactivo donde una persona puede ingresar respuestas directamente por teclado y recibir texto en pantalla. Si no está presente (como en tuberías o scripts), `setup` falla con `INTERACTIVE_REQUIRED` para proteger el flujo.

### Código de salida por cancelación del usuario (Exit Code 130 / User Interruption)
Valor numérico estándar devuelto al sistema operativo cuando una operación interactiva o un observador (`sync-watch`) es cancelado o interrumpido voluntariamente por el usuario (`no`, `cancelar`, `q`, `Ctrl+C` o fin de archivo EOF).

### Espacio central de usuario (User storage directory / `~/.forge614/`)
La carpeta privada ubicada en el directorio personal de tu computadora donde residen la configuración y la base de datos de memoria, protegida con permisos estrictos de acceso exclusivo para tu usuario (`0700`).

### Configuración global única (Global configuration file / `.env`)
El único archivo de ajustes del sistema (`~/.forge614/.env`), generado automáticamente en modo privado (`0600`). Define la versión del formato (2 para local, 3 para sincronización) y el motor de almacenamiento sin mezclar configuraciones dispersas por proyecto.

### Base de datos central única (Single SQLite database / `engram.db`)
El archivo de base de datos (`~/.forge614/engram.db`) donde se guardan todos los proyectos, recuerdos, revisiones y peticiones del sistema en una única estructura relacional local.

### Identificador único de proyecto (`projectId`)
El código alfanumérico permanente e inmutable (un UUIDv4 en minúsculas) asignado a cada proyecto registrado. Vincula de forma inequívoca todos los recuerdos de ese proyecto, asegurando que cambiar su nombre visual nunca altere su identidad ni pierda el acceso a su información.

### Nombre visual del proyecto (`name`)
Una etiqueta de texto descriptiva y legible para humanos (por ejemplo, *"Tienda Virtual"*). Es puramente cosmética; múltiples proyectos pueden compartir el mismo nombre sin conflicto porque su identidad real depende de su `projectId`.

### Alcance de una nota (`scope`)
La propiedad que define dónde aplica un recuerdo guardado. Puede ser de proyecto (`project`), aplicando exclusivamente al proyecto indicado; o compartido (`shared`), aplicando como conocimiento universal a todos los proyectos.

### Recuerdo compartido universal (Shared memory)
Una nota o preferencia general que se guarda una sola vez en la base de datos con `projectId` nulo (por ejemplo, *"Prefiero explicaciones en español"*), quedando disponible de inmediato para orientar a los asistentes en todos los proyectos sin duplicar datos en el disco.

### Sustitución o excepción por tema (Topic override)
Regla matemática y lógica que ocurre cuando un proyecto guarda un recuerdo activo con la misma clave temática (`topicKey`) exacta que un recuerdo compartido. En la búsqueda combinada del proyecto, la decisión específica del proyecto sustituye a la regla compartida, ocultando temporalmente la regla general para ese proyecto.

### Búsqueda combinada (`scope: all`)
Modo de búsqueda predeterminado al consultar desde un proyecto (`search --project-id <UUID>`), el cual devuelve tanto las notas privadas de ese proyecto como los recuerdos compartidos universales relevantes, respetando las sustituciones por tema.

### Fotografía histórica inalterable (Snapshot / Versión)
Copia digital exacta en formato JSON del texto y metadatos de un recuerdo en el momento preciso en que fue guardado. Permite viajar al pasado para auditar qué decía una decisión antes de ser modificada.

### Comprobación de lectura antes de modificar (Control optimista de versiones / `expectedVersion`)
Mecanismo de seguridad que te exige indicar qué número de versión leíste antes de permitirte guardar una nueva revisión de un tema, evitando que dos personas o programas sobreescriban notas a ciegas sin enterarse de cambios intermedios.

### Sello contra duplicados (Idempotencia / `requestKey`)
Propiedad que garantiza que enviar dos veces la misma orden con la misma clave de petición no cree notas duplicadas ni ensucie el historial; el sistema reconoce el sello y devuelve el registro ya existente.

### Motor de búsqueda de texto completo (SQLite FTS5 / `memories_fts`)
Mecanismo interno de alta velocidad que indexa todas las palabras de los recuerdos para encontrar coincidencias en milisegundos sin consumir tokens de inteligencia artificial ni requerir conexión a internet. Permanece siempre activo en tu computadora local incluso si utilizas réplicas de sincronización.

### Búsqueda por fragmentos de tres letras (Tokenizador trigram)
Técnica que divide las palabras en pedacitos consecutivos de tres letras (por ejemplo, `sqlite` se divide en `sql`, `qli`, `lit`, `ite`), permitiendo encontrar notas aunque busques partes intermedias de una palabra.

### Puntuación de relevancia textual (Algoritmo BM25)
Fórmula matemática clásica (*Best Matching 25*) que calcula qué tan bien coincide una nota con tu búsqueda, premiando palabras raras y textos concisos. En SQLite FTS5 produce números negativos donde los valores más negativos indican mayor relevancia.

### Nota fijada o destacada (`pinned`)
Marca especial (`pinned: true`) que añade una bonificación fija en la fórmula de ordenamiento para que la nota aparezca en los primeros lugares de búsqueda.

### Curva de recencia o juventud temporal ($r$)
Factor matemático suave que otorga una pequeña bonificación a las notas actualizadas recientemente (con una vida media de 30 días), permitiendo que la información fresca destaque sobre notas antiguas.

### Diario de transacciones rápidas (WAL / Write-Ahead Logging)
Modo de operación en SQLite donde los cambios se escriben primero en un diario auxiliar (`engram.db-wal`), permitiendo que los lectores consulten la base sin ser bloqueados por los escritores.

### Materialización de cabeceras WAL (Transacción inmediata vacía)
Técnica que sincroniza inmediatamente la estructura física del archivo WAL en el disco mediante `BEGIN IMMEDIATE; COMMIT;`, permitiendo que conexiones de solo lectura abran la base al instante en Bun/macOS sin proyectos.

### Archivo y restauración reversible (`archive` y `restore`)
Operaciones que permiten ocultar una nota de las búsquedas habituales sin borrarla de la base de datos, con la capacidad de reactivarla íntegramente en cualquier momento conservando todo su historial.

### Réplica PostgreSQL opcional (PostgreSQL Replica / Direct sync)
Copia de respaldo y sincronización que vive en un servidor PostgreSQL configurado por ti. Permite que múltiples computadoras compartan el mismo espacio de trabajo de Forge614 Engram sin necesidad de un servidor intermedio o una nube propietaria.

### Fusión de tres vías (3-Way Snapshot Merge)
Algoritmo de reconciliación determinista que compara la fotografía del último acuerdo común (`base`), el estado actual de tu equipo (`local`) y el estado en el servidor (`remote`) para combinar novedades de distintos proyectos o recuerdos de manera pacífica.

### Punto de control de réplica (Sync checkpoint / `sync_checkpoints`)
Tabla relacional en SQLite donde el sistema anota la última fotografía exacta acordada con una réplica remota determinada, sirviendo de base matemática para la siguiente fusión.

### Bloqueo de cabecera por comparación y reemplazo (CAS / Compare-And-Swap head locking)
Técnica de seguridad en PostgreSQL (`SELECT head FROM state WHERE id=1 FOR UPDATE`) que asegura que solo una computadora a la vez pueda publicar una nueva fotografía, evitando que dos envíos simultáneos se sobreescriban entre sí.

### Observador de sincronización en primer plano (`sync-watch`)
Comando interactivo de terminal que efectúa una sincronización inmediata y repite rondas periódicas (por defecto cada 30 segundos) mientras mantengas la ventana abierta, sin instalar servicios permanentes ni consumir recursos en segundo plano.

### Resiliencia fuera de línea (Offline resilience)
Capacidad arquitectónica de Forge614 Engram para continuar guardando, consultando y buscando recuerdos en tu computadora local con cero fallos, incluso si el servidor PostgreSQL está apagado o no tienes conexión a internet.

### Conflicto de sincronización irresoluble (`SYNC_CONFLICT`)
Situación de salvaguarda que ocurre cuando dos computadoras modificaron de forma incompatible la misma nota o proyecto respecto a la base, o cuando desaparece un registro del historial. Detiene la sincronización inmediatamente para que no se pierdan datos en ninguna de las dos partes.

### Límite de fotografía completa (Snapshot size limit / 8 MiB)
Límite estricto de protección en esta etapa que impide transmitir fotografías de memoria superiores a 8 megabytes (`SYNC_TOO_LARGE`).

### Esquema de sincronización (`forge614_sync`)
Espacio de nombres exclusivo dentro de la base de datos PostgreSQL donde se crean únicamente las tablas canónicas `revisions` y `state`.
