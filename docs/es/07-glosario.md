# Glosario de Conceptos

> **Etapa:** Etapa 1 — Memoria Local  
> **Estado:** Vigente y Activo  
> **Traducción hermana:** [English Version](../en/07-07-glosario.md)

Este glosario explica cada concepto técnico en un lenguaje cotidiano, seguido de su término técnico en inglés o nomenclatura formal entre paréntesis.

---

### Archivo de almacenamiento organizado (Base de datos / Database)
Un archivo especial en el disco duro diseñado para guardar, organizar y consultar grandes volúmenes de notas de forma estructurada, rápida y segura, sin riesgo de que los textos se mezclen.

### Ventana de instrucciones por texto (Terminal / Consola / CLI)
La aplicación de tu computadora donde escribes comandos de texto directos para comunicarte con los programas sin necesidad de botones visuales ni ratón (*Command Line Interface*).

### Formato de texto estructurado para computadoras (JSON)
Una manera universal y ordenada de organizar información mediante etiquetas y valores que tanto las personas como los programas pueden leer con facilidad (*JavaScript Object Notation*).

### Gaveta o carpeta de trabajo (Alcance de proyecto / Project scope)
Una etiqueta obligatoria que agrupa todas las notas pertenecientes a un mismo trabajo o aplicación, impidiendo que la información de un proyecto se confunda con la de otro.

### Fotografía histórica de una nota (Versión / Snapshot)
Una copia digital exacta e inalterable del texto de un recuerdo en el instante en que fue guardado. Permite viajar al pasado para revisar qué decía una nota antes de ser modificada.

### Fichero de consulta rápida (Índice de texto completo / Inverted index)
Una lista interna que la base de datos crea automáticamente con todas las palabras de tus notas. Funciona exactamente igual que el índice analítico al final de un libro, permitiendo encontrar notas en milisegundos sin tener que leer todo el disco.

### Búsqueda por fragmentos de tres letras (Tokenizador trigram)
Técnica que divide cada palabra en pedacitos consecutivos de tres letras (por ejemplo, `sqlite` se divide en `sql`, `qli`, `lit`, `ite`). Esto permite encontrar notas incluso si buscas fragmentos internos o palabras compuestas.

### Algoritmo de puntuación de coincidencia (BM25)
Una fórmula matemática clásica utilizada por los mejores buscadores del mundo para medir qué tan relevante es una nota respecto a las palabras buscadas. En SQLite genera números negativos donde los valores más alejados de cero indican mayor relevancia.

### Nota destacada o prioritaria (Recuerdo fijado / Pinned)
Una marca especial (`pinned = true`) que indica al buscador que esa nota es de suma importancia, otorgándole una bonificación en su puntuación para que aparezca en los primeros lugares de los resultados.

### Factor de frescura o juventud de la nota (Recency decay)
Un cálculo matemático que premia las notas recién actualizadas y reduce gradualmente el puntaje de notas antiguas que no se han tocado en mucho tiempo.

### Evitar guardar dos veces la misma orden (Idempotencia / Request key)
La propiedad de un comando de producir exactamente el mismo resultado sin importar cuántas veces se repita. Si una orden de guardado falla por conexión y el sistema la reintenta con la misma clave de petición, la base reconoce que ya la guardó y no crea notas duplicadas.

### Operación del "todo o nada" (Transacción atómica / Rollback)
Un mecanismo de seguridad que agrupa múltiples pasos (guardar la nota, guardar su versión en el historial, anotar el evento y actualizar el buscador). Si cualquiera de esos pasos falla a la mitad, el sistema cancela todos los cambios y deja la base en su estado previo original, evitando corrupciones parciales.

### Diario de escritura por adelantado (WAL / Write-Ahead Logging)
Un método de almacenamiento de alto rendimiento en SQLite donde las modificaciones se anotan primero en un archivo auxiliar de escritura rápida (`.sqlite-wal`), permitiendo que otros programas sigan leyendo la base de datos sin tener que esperar a que termine la escritura en el disco principal.

### Clave de clasificación temática (Topic key)
Una etiqueta identificadora (por ejemplo `architecture/database`) que agrupa todas las revisiones de un mismo concepto a lo largo del tiempo, asegurando que un proyecto solo tenga una versión vigente de esa decisión.

### Nota apartada o archivada (Archived state)
Un estado que oculta una nota de las búsquedas normales del día a día, pero la mantiene guardada con todo su historial para auditoría o futura restauración.

### Librería para desarrolladores de software (SDK / Software Development Kit)
Un conjunto de funciones y clases en código de programación (en este caso TypeScript) que permite a otros programadores integrar el sistema de memoria directamente dentro de sus propias aplicaciones sin usar la terminal.
