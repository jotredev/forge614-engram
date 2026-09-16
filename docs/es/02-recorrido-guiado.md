# 02. Recorrido Guiado del Sistema

> **Etapa:** Etapa 1 — Memoria Local  
> **Estado:** Vigente y Activo  
> **Traducción hermana:** [02 (EN). Guided System Walkthrough](../en/02-guided-walkthrough.md)

Este recorrido guiado te llevará de la mano por el ciclo de vida completo de un recuerdo en Forge614 Engram: desde su creación inicial hasta la actualización de versiones, búsqueda textual explicable, auditoría de cambios históricos y archivo reversible.

> [!NOTE]
> Todos los ejemplos utilizan el comando instalado `forge614-engram`. Si te encuentras trabajando directamente en el repositorio de código sin haber ejecutado el instalador, puedes sustituir `forge614-engram` por `bun run cli`.

---

## 1. El Concepto de Proyecto: Tu Gaveta de Trabajo

En Forge614 Engram, **cada operación está estrictamente asociada a un proyecto** mediante la opción `--project`.

El nombre del proyecto se normaliza automáticamente: se eliminan los espacios en blanco sobrantes en los extremos y se convierte todo a minúsculas (`Demo-App` se convierte internamente en `demo-app`).

Todos los recuerdos de todos tus proyectos residen dentro del mismo archivo de base de datos en tu carpeta de usuario (`~/.forge614/engram.db`). La opción `--project` garantiza que al buscar o consultar desde el proyecto `mi-web`, jamás aparezcan recuerdos del proyecto `mi-backend`.

<callout icon="⚠️" color="yellow_bg">
**Aislamiento de datos, no control de usuarios:** Esta separación organiza los datos para que proyectos distintos no se mezclen. Sin embargo, no es un sistema de contraseñas ni permisos multiusuario. Cualquier persona con acceso al archivo en el disco puede leer su contenido. **Nunca guardes contraseñas ni claves secretas**.
</callout>

> [!NOTE]
> **Diseño Aprobado Futuro (`idProject`):** En la versión actual de la Etapa 1, la gaveta de trabajo se define mediante el nombre textual en `--project`. Se ha aprobado un diseño futuro (pendiente de implementación) donde cada proyecto contará con un identificador único y estable llamado `idProject`, alojando su configuración privada en `~/.forge614/projects/<idProject>/.env`. Para más detalles técnicos, consulta [08. Límites y Hoja de Ruta](08-limites-y-roadmap.md).


---

## 2. Memorias Sueltas vs. Memorias con Tema

Existen dos maneras de guardar recuerdos en el sistema:

### Opción A: Memoria Suelta (sin tema)
Si no especificas un tema (`--topic`), el sistema crea una nota independiente:
```bash
forge614-engram save --project demo --title "Reunión de bienvenida" --content "El equipo acordó entregas semanales los viernes" --type fact
```
Si ejecutas este mismo comando dos veces (sin una clave de petición `--request-key`), el sistema creará dos notas separadas con identificadores distintos.

### Opción B: Memoria Temática (con control de versiones)
Cuando un recuerdo representa un tema que evolucionará con el tiempo (por ejemplo, la arquitectura técnica, la versión de un lenguaje o una regla de negocio), debes asignarle un tema (`--topic`):
```bash
forge614-engram save --project demo --title "Base de datos" --content "Usamos SQLite localmente" --type decision --topic architecture/database --request-key demo-v1
```

**Respuesta recibida:**
```json
{
  "id": "5617e6cd-7072-48cc-a922-1a4b269e73be",
  "project": "demo",
  "topicKey": "architecture/database",
  "type": "decision",
  "title": "Base de datos",
  "content": "Usamos SQLite localmente",
  "pinned": false,
  "version": 1,
  "createdAt": "2026-09-16T16:19:51.746Z",
  "updatedAt": "2026-09-16T16:19:51.746Z"
}
```

Al asignar el tema `architecture/database`, el sistema crea la **versión 1** con un identificador único (UUID). A partir de este momento, ese tema queda reservado dentro del proyecto `demo`.

---

## 3. Buscar Recuerdos: Coincidencia de Palabras y Puntuación Explicable

Para buscar recuerdos activos dentro del proyecto:
```bash
forge614-engram search --project demo --query SQLite
```

### Respuesta interpretada:
```json
[
  {
    "memory": {
      "id": "5617e6cd-7072-48cc-a922-1a4b269e73be",
      "project": "demo",
      "topicKey": "architecture/database",
      "type": "decision",
      "title": "Base de datos",
      "content": "Usamos SQLite localmente",
      "pinned": false,
      "version": 1,
      "state": "active",
      "createdAt": "2026-09-16T16:19:51.746Z",
      "updatedAt": "2026-09-16T16:19:51.746Z"
    },
    "explanation": {
      "mode": "fts5",
      "bm25": -0.000001,
      "multiplier": 1.0599996,
      "orderScore": -0.00000105999
    }
  }
]
```

### ¿Cómo funciona la búsqueda?
1. **Todas las palabras deben coincidir:** Si buscas `SQLite localmente`, ambas palabras deben estar presentes en la nota (en el título, en el contenido o en el tema).
2. **Explicación del orden (`explanation`):**
   - `mode: "fts5"`: La búsqueda se realizó mediante el motor de búsqueda rápida de texto completo de SQLite (FTS5).
   - `bm25`: Puntuación matemática del algoritmo BM25. En SQLite, **los números más negativos indican mayor relevancia**.
   - `multiplier`: Factor multiplicador que premia notas recientes y notas marcadas como prioritarias (`pinned`).
   - `orderScore`: El puntaje final (`bm25 * multiplier`). Los resultados se ordenan de menor a mayor (el número más negativo aparece en primer lugar).

---

## 4. Actualizar una Decisión: Control Estricto de Revisiones

Supongamos que semanas después decides añadir detalles sobre las revisiones. En un sistema común, sobreescribirías la fila y perderías la nota original.

En Forge614 Engram, para actualizar un tema existente **debes indicar obligatoriamente qué versión leíste** mediante `--expected-version`:

```bash
forge614-engram save --project demo --title "Base de datos" --content "Usamos SQLite y conservamos revisiones" --type decision --topic architecture/database --expected-version 1 --request-key demo-v2
```

### Respuesta:
```json
{
  "id": "5617e6cd-7072-48cc-a922-1a4b269e73be",
  "project": "demo",
  "topicKey": "architecture/database",
  "type": "decision",
  "title": "Base de datos",
  "content": "Usamos SQLite y conservamos revisiones",
  "pinned": false,
  "version": 2,
  "createdAt": "2026-09-16T16:19:51.746Z",
  "updatedAt": "2026-09-16T16:20:31.248Z"
}
```

### Observaciones críticas sobre la actualización:
1. **Mismo Identificador:** El `id` sigue siendo exactamente el mismo (`5617e6cd-...`).
2. **Versión Incrementada:** El número de versión subió de `1` a `2`.
3. **Reemplazo Completo:** Se reemplaza el contenido completo de la nota, no es una edición parcial.
4. **Valores Predeterminados:** Si omites `--type`, la terminal asignará `fact` por defecto; si omites `--pinned`, quedará en `false`. Si deseas mantener la categoría o la prioridad original al actualizar, debes incluirlas explícitamente en la nueva orden.
5. **Protección contra colisiones:** Si otra persona o proceso ya hubiera actualizado la versión a `2` y tú envías `--expected-version 1`, la operación fallará con el error `VERSION_CONFLICT` impidiendo que pises los cambios ajenos sin haberlos leído antes.

---

## 5. Auditoría del Historial: Consultar Versiones Pasadas

¿Cómo puedes comprobar qué decía la versión 1 antes de tu cambio? Utiliza el comando `history` con el identificador del recuerdo:

```bash
forge614-engram history --project demo --id 5617e6cd-7072-48cc-a922-1a4b269e73be
```

### Respuesta:
```json
[
  {
    "id": "5617e6cd-7072-48cc-a922-1a4b269e73be",
    "project": "demo",
    "topicKey": "architecture/database",
    "type": "decision",
    "title": "Base de datos",
    "content": "Usamos SQLite localmente",
    "pinned": false,
    "version": 1,
    "createdAt": "2026-09-16T16:19:51.746Z",
    "updatedAt": "2026-09-16T16:19:51.746Z"
  },
  {
    "id": "5617e6cd-7072-48cc-a922-1a4b269e73be",
    "project": "demo",
    "topicKey": "architecture/database",
    "type": "decision",
    "title": "Base de datos",
    "content": "Usamos SQLite y conservamos revisiones",
    "pinned": false,
    "version": 2,
    "createdAt": "2026-09-16T16:19:51.746Z",
    "updatedAt": "2026-09-16T16:20:31.248Z"
  }
]
```
Cada versión guarda una copia fotográfica completa e inmutable de cómo estaba el texto en ese momento.

---

## 6. Evitar Duplicados Accidentales (Idempotencia con `request-key`)

Cuando un programa automatizado o un script guarda una nota, puede fallar la conexión y reintentar la operación.

Para evitar guardar dos veces la misma nota, se usa una **clave de petición** (`--request-key`):
- Si reenvías exactamente los mismos datos con la misma clave `demo-v1`, el sistema detecta la huella digital (hash SHA-256) y te devuelve la versión original sin escribir nada nuevo en la base.
- Si intentas reusar la clave `demo-v1` enviando un texto diferente, el sistema lo rechazará inmediatamente con el error `REQUEST_CONFLICT`.

---

## 7. Archivar y Restaurar Recuerdos

En esta primera etapa, **no existe borrado destructivo permanente**. Si una nota ya no es aplicable o deseas retirarla del día a día, la archivas:

### Archivar:
```bash
forge614-engram archive --project demo --id 5617e6cd-7072-48cc-a922-1a4b269e73be
```
- La memoria pasa a estado `state: "archived"`.
- Desaparece por completo de las búsquedas normales (`search`).
- Sigue siendo visible y consultable si pides su ficha directa (`get`) o su historial (`history`).
- Si intentas actualizar un tema que se encuentra archivado, el sistema rechazará la orden (`ARCHIVED`) indicándote que debes restaurarlo primero.

### Restaurar:
```bash
forge614-engram restore --project demo --id 5617e6cd-7072-48cc-a922-1a4b269e73be
```
- La memoria vuelve al estado activo (`state: "active"`).
- Vuelve a aparecer inmediatamente en las búsquedas.
- **Importante:** Ni archivar ni restaurar alteran el contenido de la nota, no revierten textos modificados, no incrementan el número de versión ni modifican la fecha `updatedAt`. Únicamente conmutan la visibilidad de búsqueda.

---

## 8. Búsqueda de Términos Cortos (Modo Literal)

El motor FTS5 estándar utiliza fragmentos de tres caracteres (trigramas). Si buscas una palabra de menos de 3 letras (como `"UI"`, `"DB"` o `"Go"`), el sistema activa automáticamente el **modo de búsqueda literal**:

```bash
forge614-engram search --project demo --query "UI árbol"
```

### Características del modo literal:
- Recorre los recuerdos activos del proyecto fila por fila comparando el texto en minúsculas Unicode (`toLowerCase()`).
- Es capaz de encontrar palabras acentuadas y términos cortos sin romperse.
- En este modo no se calcula la puntuación BM25: el campo `explanation.mode` marca `"literal"`, `bm25` y `orderScore` son `null`, y los resultados se ordenan colocando primero las notas prioritarias (`pinned`) y luego las más recientemente modificadas.
