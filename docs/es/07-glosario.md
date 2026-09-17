# 07. Glosario de Conceptos en Lenguaje Cotidiano

> **Etapa:** Etapa 1 — Memoria Local (Una Sola Base y Recuerdos Compartidos)
> **Versiones de esta entrega:** Programa 0.2.0 | Formato de configuración 2 | Esquema SQLite 3
> **Estado:** Vigente y Activo
> **Traducción hermana:** [07 (EN). Plain-Language Glossary](../en/07-glossary.md)

Este glosario explica cada concepto técnico utilizando analogías y lenguaje de la vida cotidiana, seguido de su término técnico formal entre paréntesis.

---

### Espacio central de usuario (User storage directory / `~/.forge614/`)
La carpeta privada ubicada en el directorio personal de tu computadora donde residen la configuración y la base de datos de memoria, protegida con permisos estrictos de acceso exclusivo para tu usuario (`0700`).

### Configuración global única (Global configuration file / `.env`)
El único archivo de ajustes del sistema (`~/.forge614/.env`), generado automáticamente en modo privado (`0600`). Define la versión del formato y el motor de almacenamiento sin mezclar configuraciones dispersas por proyecto.

### Base de datos central única (Single SQLite database / `engram.db`)
El archivo de base de datos (`~/.forge614/engram.db`) donde se guardan todos los proyectos, recuerdos, revisiones y peticiones del sistema en una única estructura relacional.

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
Mecanismo interno de alta velocidad que indexa todas las palabras de los recuerdos para encontrar coincidencias en milisegundos sin consumir tokens de inteligencia artificial ni requerir conexión a internet.

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

### Archivo y restauración reversible (`archive` y `restore`)
Operaciones que permiten ocultar una nota de las búsquedas habituales sin borrarla de la base de datos, con la capacidad de reactivarla íntegramente en cualquier momento conservando todo su historial.

### Gestor de alto nivel del espacio (`MemoryWorkspace`)
Clase del SDK en TypeScript encargada de inicializar la configuración global, gestionar el catálogo de proyectos y abrir conexiones seguras a la base de datos.

### Motor de almacenamiento de bajo nivel (`MemoryStore`)
Clase del SDK en TypeScript que interactúa directamente con SQLite para ejecutar operaciones de guardado, búsqueda explicable, auditoría y control de versiones.
