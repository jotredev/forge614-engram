# 07. Glosario de Conceptos

> **Etapa:** Etapa 1 — Memoria Local  
> **Estado:** Vigente y Activo  
> **Traducción hermana:** [07 (EN). Plain-Language Glossary](../en/07-glossary.md)

Este glosario explica cada concepto técnico en un lenguaje cotidiano, seguido de su término técnico en inglés o nomenclatura formal entre paréntesis.

---

### Almacén central en carpeta de usuario (Base de datos global / User storage)
El archivo SQLite ubicado en `~/.forge614/engram.db` que centraliza todos los recuerdos de tu máquina, permitiendo que cualquier proyecto acceda a su propia gaveta de memoria sin dispersar archivos por el disco.

### Identificador único y estable de proyecto (idProject)
El identificador único, inmutable y permanente asignado a cada proyecto para vincular su configuración privada (`~/.forge614/projects/<idProject>/.env`) y sus recuerdos en la base de datos. Es independiente del nombre visible (el cual puede cambiar o repetirse sin afectar los datos). *Nota: Diseño aprobado pendiente de implementación.*

### Interfaz visual dentro de la terminal (TUI / Text User Interface)
Una aplicación interactiva construida con texto y paneles gráficos de consola que se navega con el teclado (flechas y Enter) directamente dentro de tu terminal habitual, ofreciendo una experiencia visual ágil sin necesidad de abrir un navegador web ni instalar ventanas pesadas.

### Lista de carpetas ejecutables del sistema (Variable PATH)
Una variable de configuración de tu computadora que contiene la lista de carpetas donde la terminal busca programas cuando escribes un comando como `forge614-engram`.

### Archivo de almacenamiento organizado (Base de datos / Database)
Un archivo especial en el disco duro diseñado para guardar, organizar y consultar grandes volúmenes de notas de forma estructurada, rápida y segura.

### Ventana de instrucciones por texto (Terminal / Consola / CLI)
La aplicación de tu computadora donde escribes comandos de texto directos para comunicarte con los programas sin necesidad de botones visuales ni ratón (*Command Line Interface*).

### Formato de texto estructurado para computadoras (JSON)
Una manera universal y ordenada de organizar información mediante etiquetas y valores que tanto las personas como los programas pueden leer con facilidad (*JavaScript Object Notation*).

### Gaveta o carpeta de trabajo (Alcance de proyecto / Project scope)
Una etiqueta obligatoria (`--project`) que agrupa todas las notas pertenecientes a un mismo trabajo o aplicación dentro de la base central, impidiendo que la información se mezcle.

### Fotografía histórica de una nota (Versión / Snapshot)
Una copia digital exacta e inalterable del texto de un recuerdo en el instante en que fue guardado. Permite viajar al pasado para auditar qué decía una nota antes de ser modificada.

### Fichero de consulta rápida (Índice de texto completo / Inverted index)
Una lista interna que la base de datos crea automáticamente con todas las palabras de tus notas para encontrar coincidencias en milisegundos.

### Búsqueda por fragmentos de tres letras (Tokenizador trigram)
Técnica que divide cada palabra en pedacitos consecutivos de tres letras (por ejemplo, `sqlite` se divide en `sql`, `qli`, `lit`, `ite`). Permite encontrar notas incluso buscando partes internas de una palabra.

### Algoritmo de puntuación de coincidencia (BM25)
Fórmula matemática clásica (*Best Matching 25*) que evalúa la relevancia textual equilibrando la frecuencia de palabras, su rareza y la longitud del texto. En SQLite FTS5 devuelve valores negativos donde los números más negativos indican mayor relevancia.

### Nota destacada o prioritaria (Recuerdo fijado / Pinned)
Una marca especial (`pinned = true`) que otorga una bonificación fija en la fórmula de ordenamiento para que la nota aparezca antes en los resultados.

### Factor de frescura o juventud de la nota (Recency decay)
Un cálculo matemático suave con vida media de 30 días que premia las notas recién actualizadas y reduce gradualmente la visibilidad de notas antiguas.

### Evitar guardar dos veces la misma orden (Idempotencia / Request key)
La propiedad de un comando de producir exactamente el mismo resultado sin importar cuántas veces se repita. Si una orden se reintenta por error de script con la misma clave, no se crean duplicados.

### Operación del "todo o nada" (Transacción atómica / Rollback)
Un mecanismo de seguridad donde múltiples pasos se ejecutan como una unidad indivisible: si uno falla a la mitad, se cancelan todos los cambios.

### Diario de escritura por adelantado (WAL / Write-Ahead Logging)
Un método de almacenamiento en SQLite donde las modificaciones se anotan primero en un archivo auxiliar rápido (`engram.db-wal`). Lectores y escritores no se bloquean mutuamente, aunque las escrituras siguen estando serializadas.

### Clave de clasificación temática (Topic key)
Una etiqueta (ej. `architecture/database`) que agrupa todas las revisiones de una misma decisión a lo largo del tiempo.

### Nota apartada o archivada (Archived state)
Un estado que retira una nota de las búsquedas normales del día a día, pero la mantiene guardada con todo su historial.

### Librería para desarrolladores de software (SDK / Software Development Kit)
La clase `MemoryStore` en TypeScript que permite a otros programadores integrar el sistema de memoria directamente en sus aplicaciones.
