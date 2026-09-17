# 02. Recorrido Guiado del Sistema

> **Etapa:** Etapa 1 — Memoria Local (Configuración Interactiva y Base Única)
> **Versiones de esta entrega:** Programa 0.3.0 | Formato de configuración 2 | Esquema SQLite 3
> **Estado:** Vigente y Activo
> **Traducción hermana:** [02 (EN). Guided System Walkthrough](../en/02-guided-walkthrough.md)

Este recorrido práctico te guiará paso a paso por el ciclo de vida completo de Forge614 Engram: desde configurar el espacio global interactivamente con `setup` y registrar proyectos, hasta guardar recuerdos propios y compartidos, realizar búsquedas combinadas, aplicar sustituciones temáticas (*topic overrides*), auditar el historial inmutable y gestionar el archivo reversible.

> [!NOTE]
> Todos los ejemplos utilizan el ejecutable binario instalado `forge614-engram`. Si estás trabajando directamente en el repositorio de código fuente con Bun, puedes sustituir `forge614-engram` por `bun run cli`.

---

## 1. El Concepto de Proyecto y su Identidad (`projectId`)

En Forge614 Engram, **todos los proyectos comparten una única base de datos (`~/.forge614/engram.db`) y un único archivo de configuración (`~/.forge614/.env`)**.

Dentro de esa base, los proyectos se registran formalmente con dos elementos:
1. **`projectId` (Identificador único e inmutable):** Es un código UUIDv4 en minúsculas generado automáticamente (por ejemplo `7c9e6679-7425-40de-944b-e07fc1f90ae7`). Es la clave que vincula todos los recuerdos a ese proyecto.
2. **`name` (Nombre visual descriptivo):** Una etiqueta legible para los humanos (por ejemplo, `"Tienda Virtual"`). Cambiar el nombre con `project-rename` jamás cambia el `projectId` ni altera los recuerdos guardados.

<callout icon="⚠️" color="yellow_bg">
**Aislamiento lógico, no control multiusuario:** El aislamiento por `projectId` organiza tus datos para que un proyecto jamás lea los recuerdos privados de otro. Sin embargo, no es un sistema de contraseñas de red ni permisos de usuario. Cualquier programa que se ejecute con tu usuario en la computadora puede acceder al almacén. **Nunca guardes contraseñas, secretos de API ni tokens privados en tus recuerdos.**
</callout>

---

## 2. Los Dos Alcances de un Recuerdo (`scope`)

El campo `scope` define dónde aplica cada nota guardada:

| Alcance (`scope`) | Identificador (`projectId`) | Propósito y Uso |
| :--- | :--- | :--- |
| **`project`** | UUID de un proyecto registrado | Decisiones, hechos o reglas que aplican **únicamente a ese proyecto**. |
| **`shared`** | `null` (sin proyecto) | Preferencias o aprendizajes universales que aplican a **todos los proyectos**. |

### Ejemplos cotidianos:
- *"Esta aplicación utiliza SQLite"* $\rightarrow$ Alcance de **proyecto** (`scope: project`).
- *"Prefiero explicaciones en español"* $\rightarrow$ Alcance **compartido** (`scope: shared`).

Un recuerdo compartido se guarda **una sola vez en la base de datos**; no se clona ni se duplica en cada proyecto.

---

## 3. Recorrido Paso a Paso del Ciclo de Vida

### Paso 1: Configurar el Espacio Global (`setup` o `init`)

Para personas frente a la terminal, el comando interactivo `setup` explica las rutas y solicita confirmación antes de modificar el disco:

```bash
forge614-engram setup
```

**Flujo en la terminal:**
```text
Forge614 Engram — configuración guiada
Escribe cancelar o q, o pulsa Ctrl+C, para salir antes de confirmar.
Una configuración global: "/Users/usuario/.forge614/.env"
Una base SQLite para todos los proyectos: "/Users/usuario/.forge614/engram.db"
SQLite guarda tus recuerdos en este equipo. PostgreSQL todavía no está disponible. No se pedirán credenciales ni se conectarán asistentes en este paso.
Se preparará el espacio global al confirmar. Una base existente solo se reutilizará si es compatible; nunca se borrará ni reemplazará.
Resumen: configurar el almacenamiento global SQLite. No se crearán ni seleccionarán proyectos y no se borrarán datos.
¿Confirmar? [si/NO]: si
Configuración global lista. No necesitas elegir un proyecto para configurar Engram.
La identificación de proyectos y el guardado automático con asistentes siguen pendientes de integración.
```

- Si decides cancelar escribiendo `no`, `cancelar`, `q`, pulsando Enter o con `Ctrl+C`, la terminal finaliza con **código 130** y no se crea ningún archivo.
- `setup` **no administra proyectos**: no pregunta, no lista, no crea ni selecciona proyectos.
- Para automatizaciones o scripts sin terminal interactiva, utiliza el comando silencioso `init`:
  ```bash
  forge614-engram init
  # Salida JSON: {"initialized":true,"storage":"sqlite"}
  ```

---

### Paso 2: Crear un Proyecto (`project-create`)
Registramos nuestro proyecto con su nombre comercial:

```bash
forge614-engram project-create --name "Tienda Virtual"
```

**Respuesta JSON:**
```json
{
  "projectId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "name": "Tienda Virtual",
  "createdAt": "2026-09-16T20:10:00.000Z",
  "updatedAt": "2026-09-16T20:10:00.000Z"
}
```

*(Guarda el `projectId` devuelto para usarlo en todos los comandos de tu proyecto).*

Puedes listar todos los proyectos registrados cuando lo desees:
```bash
forge614-engram project-list
```

---

### Paso 3: Guardar Recuerdos del Proyecto (`save --project-id`)
Podemos guardar recuerdos de dos maneras dentro de un proyecto:

#### A. Recuerdo suelto (sin tema)
Si la nota no necesita versionado temporal:
```bash
forge614-engram save --project-id 7c9e6679-7425-40de-944b-e07fc1f90ae7 --title "Reunión de inicio" --content "El cliente solicitó entregas quincenales" --type fact
```

#### B. Recuerdo temático (con control de versiones e idempotencia)
Si la nota representa una decisión técnica que cambiará en el tiempo, asígnale un tema (`--topic`) y una clave de petición (`--request-key`):
```bash
forge614-engram save --project-id 7c9e6679-7425-40de-944b-e07fc1f90ae7 --title "Motor de base de datos" --content "Usaremos SQLite localmente" --type decision --topic architecture/database --request-key req-db-v1
```

**Respuesta JSON:**
```json
{
  "id": "5617e6cd-7072-48cc-a922-1a4b269e73be",
  "projectId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "scope": "project",
  "topicKey": "architecture/database",
  "type": "decision",
  "title": "Motor de base de datos",
  "content": "Usaremos SQLite localmente",
  "pinned": false,
  "version": 1,
  "state": "active",
  "createdAt": "2026-09-16T20:11:00.000Z",
  "updatedAt": "2026-09-16T20:11:00.000Z"
}
```

---

### Paso 4: Guardar una Preferencia Compartida (`save --scope shared`)
Guardamos una regla que oriente a los asistentes en todos nuestros proyectos:

```bash
forge614-engram save --scope shared --title "Idioma preferido" --content "Prefiero explicaciones en español" --type preference --topic preferences/language
```

**Respuesta JSON:**
```json
{
  "id": "e2f1c0d9-b8a7-4655-9012-3456789abcde",
  "projectId": null,
  "scope": "shared",
  "topicKey": "preferences/language",
  "type": "preference",
  "title": "Idioma preferido",
  "content": "Prefiero explicaciones en español",
  "pinned": false,
  "version": 1,
  "state": "active",
  "createdAt": "2026-09-16T20:12:00.000Z",
  "updatedAt": "2026-09-16T20:12:00.000Z"
}
```

---

### Paso 5: Búsqueda Combinada desde el Proyecto
Cuando buscas desde un proyecto (`search --project-id <UUID>`), el sistema utiliza **por defecto el alcance combinado (`--scope all`)**:

```bash
forge614-engram search --project-id 7c9e6679-7425-40de-944b-e07fc1f90ae7 --query "español"
```

**Respuesta JSON:**
```json
[
  {
    "memory": {
      "id": "e2f1c0d9-b8a7-4655-9012-3456789abcde",
      "projectId": null,
      "scope": "shared",
      "topicKey": "preferences/language",
      "type": "preference",
      "title": "Idioma preferido",
      "content": "Prefiero explicaciones en español",
      "pinned": false,
      "version": 1,
      "state": "active",
      "createdAt": "2026-09-16T20:12:00.000Z",
      "updatedAt": "2026-09-16T20:12:00.000Z"
    },
    "explanation": {
      "mode": "fts5",
      "bm25": -0.000001,
      "multiplier": 1.059999,
      "orderScore": -0.000001059999
    }
  }
]
```

La búsqueda combinada te devolvió la preferencia compartida sin importar que no fuera un recuerdo exclusivo de este proyecto. Y lo más importante: **jamás te devolverá recuerdos de otros proyectos ajenos**.

Si solo quisieras ver recuerdos propios de ese proyecto, añade `--scope project`:
```bash
forge614-engram search --project-id 7c9e6679-7425-40de-944b-e07fc1f90ae7 --scope project --query "SQLite"
```

---

## 4. La Regla de Excepción por Tema (*Topic Override*)

¿Qué sucede si tienes una regla general compartida pero un proyecto en particular necesita una excepción?

### Escenario Práctico Comprobable:
1. **Regla General Compartida:**
   Guardamos una directriz compartida con el tema `runtime`:
   ```bash
   forge614-engram save --scope shared --title "Entorno de ejecución" --content "Bun como preferencia general" --type preference --topic runtime
   ```
2. **Excepción en el Proyecto:**
   En nuestro proyecto `Tienda Virtual` necesitamos Node.js por compatibilidad. Guardamos un recuerdo en el proyecto con el **mismo tema exacto** (`runtime`):
   ```bash
   forge614-engram save --project-id 7c9e6679-7425-40de-944b-e07fc1f90ae7 --title "Entorno de ejecución" --content "Node.js por compatibilidad con este proyecto" --type decision --topic runtime
   ```
3. **Búsqueda Combinada del Proyecto:**
   Consultamos el entorno de ejecución desde el proyecto:
   ```bash
   forge614-engram search --project-id 7c9e6679-7425-40de-944b-e07fc1f90ae7 --query "ejecución"
   ```
   **Resultado:** Aparece **únicamente** la nota del proyecto (*"Node.js..."*). La regla compartida (*"Bun..."*) queda **automáticamente excluida**.
4. **Conservación de la Regla Compartida:**
   La regla compartida **no fue borrada ni modificada**. Otros proyectos la siguen recibiendo con normalidad, y puedes consultarla directamente con:
   ```bash
   forge614-engram search --scope shared --query "Bun"
   ```
5. **Reversibilidad comprobable:**
   Si archivas la excepción del proyecto:
   ```bash
   forge614-engram archive --project-id 7c9e6679-7425-40de-944b-e07fc1f90ae7 --id <id-excepcion-proyecto>
   ```
   Al buscar de nuevo en el proyecto, la regla compartida de Bun **vuelve a aparecer automáticamente**. Si más tarde restauras la excepción (`restore`), la preferencia del proyecto vuelve a sustituir a la compartida.

> [!IMPORTANT]
> La comparación de temas (`topicKey`) es exacta y distingue entre mayúsculas y minúsculas (*case-sensitive*). No requiere coincidencia semántica por IA ni entrenamiento: es una regla estricta y transparente impuesta en la consulta SQL.

---

## 5. Actualización de Versiones y Control Optimista

Si con el tiempo decides actualizar la decisión sobre la base de datos de tu proyecto, **debes indicar la versión que leíste** mediante `--expected-version`:

```bash
forge614-engram save --project-id 7c9e6679-7425-40de-944b-e07fc1f90ae7 --title "Motor de base de datos" --content "Usaremos SQLite localmente con modo WAL" --type decision --topic architecture/database --expected-version 1 --request-key req-db-v2
```

**Respuesta JSON:**
```json
{
  "id": "5617e6cd-7072-48cc-a922-1a4b269e73be",
  "projectId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "scope": "project",
  "topicKey": "architecture/database",
  "type": "decision",
  "title": "Motor de base de datos",
  "content": "Usaremos SQLite localmente con modo WAL",
  "pinned": false,
  "version": 2,
  "state": "active",
  "createdAt": "2026-09-16T20:11:00.000Z",
  "updatedAt": "2026-09-16T20:20:00.000Z"
}
```

El campo `version` subió a `2`. Si un proceso intentara enviar `--expected-version 1` nuevamente, el sistema rechazaría la orden con el error `VERSION_CONFLICT` para proteger la nota de sobreescrituras ciegas.

---

## 6. Auditoría, Inspección y Archivo Reversible

### Consultar el Historial de Versiones (`history`)
Puedes ver cada versión fotográfica guardada en el tiempo:

```bash
forge614-engram history --project-id 7c9e6679-7425-40de-944b-e07fc1f90ae7 --id 5617e6cd-7072-48cc-a922-1a4b269e73be
```

Devuelve un arreglo JSON ordenado cronológicamente con la versión 1 y la versión 2 completas.

---

### Regla Crucial sobre Modificación de Recuerdos Compartidos
<callout icon="🛑" color="red_bg">
Haber encontrado un recuerdo compartido en una búsqueda combinada de proyecto **NO te permite modificarlo ni archivarlo pasando `--project-id`**.
</callout>

- Para modificar, archivar o restaurar un recuerdo propio del proyecto:
  ```bash
  forge614-engram archive --project-id <UUID> --id <id-recuerdo>
  ```
- Para modificar, archivar o restaurar un recuerdo compartido:
  ```bash
  forge614-engram archive --scope shared --id <id-recuerdo>
  ```
Intentar combinar `--scope shared` con `--project-id` provocará un error inmediato (`INVALID_INPUT`).

---

### Renombrar un Proyecto (`project-rename`)
Si tu empresa cambia de nombre comercial:

```bash
forge614-engram project-rename --project-id 7c9e6679-7425-40de-944b-e07fc1f90ae7 --name "Tienda Global 2026"
```

El nombre se actualiza inmediatamente. Como el `projectId` se mantiene idéntico, **no se pierde ni un solo recuerdo, versión ni clave de petición**.
