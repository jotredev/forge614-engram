# 02. Recorrido Guiado del Sistema

> **Etapa:** MCP Local, Menú TUI de Asistentes, Memoria Local y Sincronización PostgreSQL Opcional
> **Versiones de esta entrega:** Programa 0.5.0 | Formato de configuración 2 (local) / 3 (con sync) | Esquema SQLite 3 (local) / 4 (con sync) / 5 (asistentes y asociaciones locales)
> **Estado:** Vigente y Activo (Verificado con 191 pruebas en macOS con Bun 1.3.8)
> **Traducción hermana:** [02 (EN). Guided System Walkthrough](../en/02-guided-walkthrough.md)

Este recorrido práctico te guía paso a paso por el ciclo de vida integral de Forge614 Engram: desde configurar el espacio global interactivamente con `setup`, conectar tus asistentes de desarrollo mediante el menú interactivo en terminal `tui`, interactuar a través del protocolo MCP nativo con resolución automática de proyectos por Git, hasta realizar búsquedas explicables, actualizar temas con control estricto de versiones y sincronizar réplicas con PostgreSQL.

---

## 1. El Concepto de Proyecto y su Identidad (`projectId`)

En Forge614 Engram, **todos los proyectos comparten una única base de datos (`~/.forge614/engram.db`) y un único archivo de configuración (`~/.forge614/.env`)**.

Dentro de esa base, los proyectos se registran formalmente con dos elementos:
1. **`projectId` (Identificador único e inmutable):** Es un código UUIDv4 en minúsculas generado automáticamente (por ejemplo `7c9e6679-7425-40de-944b-e07fc1f90ae7`). Es la clave que vincula todos los recuerdos a ese proyecto.
2. **`name` (Nombre visual descriptivo):** Una etiqueta legible para los humanos (por ejemplo, `"Tienda Virtual"`). Cambiar el nombre con `project-rename` jamás cambia el `projectId` ni altera los recuerdos guardados.

> [!WARNING]
> **Aislamiento lógico, no control multiusuario:** El aislamiento por `projectId` organiza tus datos para que un proyecto jamás lea los recuerdos privados de otro. Sin embargo, no es un sistema de contraseñas de red ni permisos de usuario. Cualquier programa que se ejecute con tu usuario en la computadora puede acceder al almacén. **Nunca guardes contraseñas, secretos de API ni tokens privados en tus recuerdos.**

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

Para inicializar tu espacio central de trabajo de forma guiada:

```bash
forge614-engram setup
```

**Flujo interactivo en la terminal:**
1. Muestra la ubicación de los archivos centrales: `~/.forge614/.env` y `~/.forge614/engram.db`.
2. Pregunta si deseas habilitar sincronización con PostgreSQL:
   - Opción 1: `No` (predeterminada, modo exclusivamente local).
   - Opción 2: `Sí, configurar PostgreSQL` (solicita URL con entrada oculta y advertencia de réplica total).
3. Presenta el resumen de cambios y pide confirmación explícita (`Sí, aplicar cambios` o `Cancelar y salir`).
4. Al confirmar, prepara la carpeta `0700`, escribe el archivo `.env` en `0600` e inicializa `engram.db`.
5. Si cancelas con `Ctrl+C` o `q`, termina con código **130** sin tocar el disco.

---

### Paso 2: Menú Interactivo de Asistentes (`tui`)

Para conectar tus clientes de desarrollo (Claude Code, Codex, Cursor, OpenCode y Gemini CLI) sin editar manualmente archivos JSON o TOML, abre el menú interactivo en terminal:

```bash
forge614-engram tui
```

> [!NOTE]
> `tui` requiere una terminal interactiva real (`TTY` con soporte de modo crudo / *raw mode*). Si se invoca sin terminal interactiva (por ejemplo, redirigiendo la entrada o dentro de un pipe), falla inmediatamente arrojando el error `INTERACTIVE_REQUIRED`. Para inspecciones en scripts, utiliza el comando de solo lectura `assistant-list`.

#### Controles del Menú TUI:
- **Flechas Arriba / Abajo (`↑` / `↓`):** Desplazan el cursor entre las opciones del menú y la lista de asistentes.
- **Barra Espaciadora (`Espacio`):** Marca o desmarca los clientes que deseas configurar.
- **Tecla `r` o "Redetectar":** Vuelve a escanear el PATH y las rutas predeterminadas de tu sistema para actualizar el estado de los ejecutables y archivos de configuración.
- **Tecla `c` o "Personalizar":** Permite introducir rutas personalizadas para el ejecutable del cliente y su directorio de configuración mediante entradas enmascaradas (no pegues secretos ni credenciales).
- **Tecla `t` o "Probar servidor propio (opcional)":** Inicia una **autoprueba asíncrona** del servidor MCP de Engram:
  - Inicializa el ejecutable instalado (`forge614-engram`) a través del SDK oficial de MCP por stdio.
  - Verifica que el servidor responda con el nombre `forge614-engram` y exponga las 5 herramientas esperadas (`memory_current_project`, `memory_search`, `memory_get`, `memory_save`, `memory_history`).
  - Cuenta con un plazo estricto de **5 segundos**. Si vence el plazo, arroja `TIMED_OUT` y fuerza el cierre del proceso hijo con hasta 250 ms adicionales de gracia para recolectarlo.
  - Presionar `Escape` durante la prueba cancela únicamente la autoprueba y conserva las selecciones del usuario.
  - **Importante:** La autoprueba verifica únicamente el ejecutable propio de Engram instalado en tu sistema; **no prueba las sesiones reales de los clientes ni ejecuta comandos extraídos de sus configuraciones**. Las sesiones de los clientes quedan en estado no probado hasta que las verifiques dentro de cada cliente.
- **Tecla `Enter`:**
  - En la lista de clientes con asistentes seleccionados: genera el plan de configuración y abre la **Pantalla de Vista Previa**.
  - En la pantalla de vista previa: abre la **Pantalla de Confirmación**.
  - En la pantalla de confirmación: valida todos los planes mediante *preflight*, habilita el Esquema 5 en SQLite y aplica las configuraciones.
- **Tecla `Escape`:** Retrocede a la pantalla anterior (`Confirmación` $\rightarrow$ `Vista Previa` $\rightarrow$ `Lista de Asistentes` $\rightarrow$ `Menú Principal` $\rightarrow$ `Salir`).
- **`Ctrl+C`:** Cancela la sesión en cualquier momento, finaliza cualquier proceso hijo, restaura la terminal y devuelve el código de salida **130**.
- **`PgUp` / `PgDn` y Flechas en Vista Previa:** Desplazan el texto de avisos, políticas y advertencias en pantallas pequeñas.

#### Seguridad y Garantías en la Aplicación de Configuraciones:
1. **Vista previa sin escritura:** Seleccionar asistentes y previsualizar jamás escribe archivos en el disco.
2. **Preflight estricto:** Antes de escribir, verifica permisos, descarta enlaces simbólicos (*symlinks*) y valida que los archivos no superen el límite de tamaño.
3. **Copias de seguridad privadas:** Antes de modificar cualquier archivo de configuración existente, crea una copia de respaldo exacta en modo `0600` con sufijo UUID (por ejemplo, `settings.json.019183ab-....bak`).
4. **Preservación de comentarios y contenido ajeno:** Los adaptadores utilizan analizadores tolerantes (JSONC y TOML) que preservan comentarios y configuraciones de otras herramientas sin sobreescribirlas.
5. **Verificación posterior (*Post-Publication Verification*):** Tras escribir el archivo, Engram lo vuelve a leer y compara los bytes exactos. Si otro proceso modificó el archivo durante la operación, reporta `PUBLISHED_UNVERIFIED` («Publicado sin verificar»), conserva las copias de respaldo y no intenta deshacer cambios externos a ciegas.
6. **Manejo de fallos parciales:** Si se seleccionaron varios clientes y uno de ellos falla, el menú reporta claramente qué archivos fueron aplicados con éxito, cuáles no se pudieron verificar y qué copias de respaldo fueron retenidas, sin revertir los cambios de los clientes exitosos.

---

### Paso 3: Interacción de los Asistentes a través de MCP

Una vez configurado tu cliente (por ejemplo, Claude Code o Codex), el asistente invoca internamente el comando del servidor MCP:

```bash
forge614-engram mcp
```

> [!IMPORTANT]
> El servidor `mcp` se comunica mediante el protocolo MCP estándar a través de la entrada y salida estándar (`stdio`). Reserva `stdout` exclusivamente para el intercambio de mensajes JSON-RPC. Nunca emite texto decorativo ni códigos ANSI.

#### Las 5 Herramientas Expuestas al Asistente:

1. **`memory_current_project` (`directory?`):**
   Resuelve el contexto del proyecto local actual basándose en Git sin crear ningún proyecto en la base de datos. Si la carpeta es un repositorio Git, devuelve su `projectId` vinculado o indica que aún no tiene vinculación.
2. **`memory_search` (`query`, `directory?`, `limit?`, `scope?`):**
   Realiza una búsqueda explicable de recuerdos activos. Es una operación de solo lectura y jamás crea un proyecto. Si no se especifica `scope`, busca por defecto en el proyecto actual y en recuerdos compartidos (`all`).
3. **`memory_get` (`id`, `directory?`, `scope?`):**
   Obtiene un recuerdo por su identificador único tras comprobar que pertenece al proyecto activo o al alcance compartido.
4. **`memory_save` (`title`, `content`, `type`, `directory?`, `scope?`, `globalIntent?`, `topicKey?`, `pinned?`, `expectedVersion?`, `requestKey?`):**
   Guarda o actualiza un recuerdo duradero.
   - **Alcance de proyecto por defecto:** Si no se indica `scope`, se asume `project`.
   - **Creación atómica de proyecto:** Al guardar el primer recuerdo de una carpeta Git no registrada, Engram crea automáticamente el proyecto, registra la asociación local en `project_bindings` y almacena el recuerdo dentro de una única transacción atómica.
   - **Alcance compartido explícito:** Para guardar con `scope: "shared"`, el asistente **debe proporcionar obligatoriamente una explicación en `globalIntent`** justificando por qué la nota aplica a todos los proyectos. Si no se proporciona `globalIntent`, el guardado se rechaza arrojando `SHARED_INTENT_REQUIRED`.
5. **`memory_history` (`id`, `directory?`, `scope?`):**
   Consulta la lista inmutable de todas las revisiones pasadas de un recuerdo para auditar cómo evolucionó una decisión técnica.

---

### Paso 4: Identidad de Proyectos por Git y Vinculación Manual (`project-bind`)

#### ¿Cómo detecta Engram a qué proyecto pertenece una carpeta?
Engram ejecuta internamente `git rev-parse --path-format=absolute --git-common-dir` para obtener la raíz canónica del repositorio Git.
- **Ramas vinculadas (*linked worktrees*):** Si tienes dos carpetas de trabajo para el mismo repositorio (por ejemplo, la rama principal y una rama de características creada con `git worktree add`), ambas comparten exactamente la misma identidad de proyecto y acceden a los mismos recuerdos.
- **Subcarpetas anidadas:** Si abres tu terminal o editor dentro de `src/componentes/`, Engram identifica la raíz Git común y asocia los recuerdos al proyecto raíz.
- **Carpetas sin Git:** Si una carpeta no es un repositorio Git, Engram exige indicar la ruta explícita o disponer de una única raíz MCP; de lo contrario, falla con `PROJECT_DIRECTORY_REQUIRED` para no adivinar identidades a partir de la carpeta del ejecutable.

#### Bloqueo Conservador y Vinculación Manual (`project-bind`):
Para evitar corromper la memoria o crear proyectos duplicados accidentalmente:
- Si trasladaste una carpeta a otra ruta o clonaste un proyecto en una computadora nueva, el identificador `projectId` existe en la base de datos pero la ruta local no está registrada.
- Antes de crear automáticamente una identidad para una carpeta desconocida, Engram revisa las rutas registradas. Si todas las rutas de algún proyecto registrado se encuentran ausentes del disco, el sistema bloquea conservadoramente la resolución arrojando `PROJECT_BINDING_REQUIRED`.
- Para resolver esta ambigüedad, vincula explícitamente la carpeta con su proyecto:

```bash
# 1. Listar proyectos existentes para obtener el UUID
forge614-engram project-list

# 2. Asociar la carpeta local al proyecto
forge614-engram project-bind \
  --directory "/Users/usuario/Desktop/mi-proyecto" \
  --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7"
```

Salida esperada:
```json
{
  "projectId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "directory": "/Users/usuario/Desktop/mi-proyecto",
  "source": "binding"
}
```

---

### Paso 5: Ganchos Nativos de Asistentes (`memory-hook`)

Para clientes compatibles que soportan ganchos (*hooks* o *plugins*), Engram inyecta recordatorios de orientación en eventos como inicio de sesión (`SessionStart`) o envío de prompt (`UserPromptSubmit`):

```bash
forge614-engram memory-hook --client codex
```

Este comando:
- Se ejecuta como adaptador nativo invocado por el cliente.
- Emite un bloque JSON de contexto nativo orientando al modelo a consultar `memory_current_project` y `memory_search` antes de repetir investigación técnica.
- **No escribe recuerdos directamente.** La escritura siempre la realiza el asistente mediante la herramienta MCP `memory_save`.

> [!IMPORTANT]
> **Aprobación de Hooks en Codex:** En Codex, los ganchos nuevos deben ser revisados y aprobados explícitamente mediante el comando `/hooks` dentro de Codex antes de que puedan ejecutarse.

---

### Paso 6: Búsqueda Explicable y Sustitución por Tema (*Topic Override*)

Supongamos que guardamos un recuerdo compartido universal y un recuerdo específico en el proyecto:

```bash
# Regla compartida general:
forge614-engram save \
  --scope shared \
  --topic "runtime-preferido" \
  --title "Runtime General" \
  --content "Usar Bun para todos los proyectos nuevos." \
  --type preference

# Excepción específica del proyecto:
forge614-engram save \
  --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7" \
  --topic "runtime-preferido" \
  --title "Excepción de Runtime" \
  --content "Usar Node.js 20 LTS por requerimientos del cliente." \
  --type decision
```

Al buscar desde el proyecto (`--scope all` predeterminado):
```bash
forge614-engram search --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7" --query "runtime"
```
Engram aplica la **sustitución temática (*topic override*)**: el recuerdo del proyecto sustituye al compartido con el mismo tema (`topicKey`), entregando la excepción del proyecto. Si más tarde archivas la excepción del proyecto, la regla compartida vuelve a mostrarse automáticamente.

---

### Paso 7: Sincronización con PostgreSQL (`sync` y `sync-watch`)

Si configuraste una réplica PostgreSQL en `setup`:

#### Sincronización Manual Inmediata:
```bash
forge614-engram sync
```
Salida esperada:
```json
{
  "synchronized": true,
  "projects": 3,
  "memories": 12
}
```

#### Sincronización Continua en Primer Plano:
```bash
forge614-engram sync-watch --interval 30
```
- Realiza una ronda inmediata de sincronización y luego reintenta cada 30 segundos.
- Es un proceso en primer plano; no instala demonios ni servicios de fondo.
- Al cerrarse con `Ctrl+C`, devuelve código 130 y los datos locales quedan a salvo en SQLite.
