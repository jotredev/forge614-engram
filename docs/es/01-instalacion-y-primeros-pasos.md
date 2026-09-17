# 01. Instalación, Configuración y Primeros Pasos

> **Etapa:** Etapa 1 — Memoria Local (Una Sola Base y Recuerdos Compartidos)
> **Versiones de esta entrega:** Programa 0.2.0 | Formato de configuración 2 | Esquema SQLite 3
> **Estado:** Vigente y Verificado (65 pruebas superadas, 0 fallos en macOS con Bun 1.3.8)
> **Traducción hermana:** [01 (EN). Installation, Setup, and Getting Started](../en/01-installation-and-getting-started.md)

Esta guía te explica paso a paso cómo compilar e instalar el comando `forge614-engram` en tu computadora, cómo funciona el espacio único de configuración y base de datos del usuario, y cómo registrar tus primeros recuerdos (tanto de proyecto como compartidos) en menos de tres minutos.

---

## 1. ¿Qué es este programa y cómo se distribuye?

Forge614 Engram es un sistema de memoria personal y local para modelos de lenguaje y desarrolladores, construido en **TypeScript**. A diferencia de los paquetes públicos de internet:
- **No se descarga desde npm:** `npm install forge614-engram` no existe porque se trata de un paquete privado de desarrollo.
- **Se compila localmente:** Se empaqueta directamente desde el código fuente del repositorio usando el script de instalación (`scripts/install.sh`).
- **Produce un ejecutable binario autónomo:** El resultado es un archivo binario independiente llamado `forge614-engram`. Una vez instalado, **no requiere tener Bun ni Node.js en el PATH** para su ejecución habitual.

### Requisitos del Sistema
1. **Bun (versión estable >= 1.3.8):**
   Requisito exclusivo para **compilar e instalar** el programa desde el código fuente.
   ```bash
   bun --version
   ```
   Si no lo tienes instalado, descárgalo desde [bun.sh](https://bun.sh).
2. **Sistema Operativo:**
   Esta entrega documental se encuentra verificada y probada en **macOS**. El script de instalación admite entornos compatibles con Bash y sistemas tipo Unix.

---

## 2. Instalación mediante el Script Autónomo

Desde la carpeta raíz del repositorio (`/Users/jorgeetrejoo/Desktop/forge614-engram`):

```bash
bash scripts/install.sh
```

### ¿Qué realiza exactamente el instalador?
1. Verifica que la versión de Bun sea igual o superior a 1.3.8.
2. Ejecuta `bun build ./src/cli.ts --compile` para empaquetar el código TypeScript, las dependencias y el motor nativo de SQLite en un archivo ejecutable único.
3. Lo copia por defecto a la carpeta de ejecutables de tu usuario:
   `$HOME/.local/bin/forge614-engram`
4. **Protección contra sobreescritura accidental:** Si el archivo ya existe en esa carpeta, el instalador se detiene para evitar sobrescribir ejecutables existentes sin previo aviso. Para actualizar o reinstalar el binario, usa la bandera `--force`:
   ```bash
   bash scripts/install.sh --force
   ```
   *(Nota: `--force` reemplaza únicamente el archivo ejecutable binario; jamás toca tu configuración ni borra tu base de datos).*
5. **Directorio de instalación personalizado:** Si deseas colocar el binario en otra carpeta de ejecutables:
   ```bash
   bash scripts/install.sh --bin-dir /ruta/personalizada/bin
   ```

---

## 3. Configurar tu Terminal (La Variable PATH)

Para poder escribir `forge614-engram` directamente desde cualquier carpeta sin tener que escribir la ruta completa, tu terminal debe conocer la ubicación del archivo.

### ¿Qué es el PATH?
El **PATH** es la lista de carpetas donde tu sistema operativo busca programas cada vez que escribes un nombre de comando en la consola de comandos (la terminal).

Si `$HOME/.local/bin` aún no forma parte de tu PATH, agrega esta línea en tu sesión actual de terminal:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

> [!TIP]
> Para que esta configuración quede guardada permanentemente y esté lista cada vez que abras una ventana nueva, añade la línea anterior a tu archivo de inicio de consola (`~/.zshrc` en macOS o `~/.bashrc` en Linux).

---

## 4. Comprobar la Instalación

Una vez configurado el PATH, comprueba la versión instalada y consulta la ayuda de comandos sin tocar el disco duro ni crear archivos:

```bash
# Comprobar la versión instalada
forge614-engram --version
# Salida esperada: forge614-engram 0.2.0

# Consultar el manual de ayuda de la terminal
forge614-engram help
```

### Salida oficial de `forge614-engram help`:
```text
Forge614 Engram — una base, recuerdos por proyecto y compartidos

Uso: forge614-engram <comando> [opciones]

init            Inicializa una sola configuración y base local, sin borrar datos.
project-create  --name <nombre>
project-list    Lista todos los proyectos de la base.
project-rename  --project-id <UUID> --name <nombre>

Recuerdos: --project-id <UUID> (scope project por defecto) O --scope shared.
save     --title <título> --content <texto> [--type fact|decision|procedure|warning|preference]
         [--topic <tema>] [--expected-version <versión>] [--request-key <clave>]
         [--pinned true|false]
get      --id <recuerdo>
history  --id <recuerdo>
archive  --id <recuerdo>
restore  --id <recuerdo>

search   --query <texto> [--limit <1..100>]
         --project-id <UUID> [--scope all|project|shared]
         O --scope shared (sin proyecto)
         Con proyecto, all es el valor por defecto: proyecto + shared.

help      Muestra esta ayuda sin crear archivos.
--version Muestra la versión instalada.

Una configuración: ~/.forge614/.env. Una base SQLite: ~/.forge614/engram.db.
No hay conexiones, carpetas .env ni bases diferentes por proyecto.
--db, --project y --id-project no se admiten. El identificador se llama projectId.
project-create inicializa el espacio si aún no existe configuración.
Para guardar shared sin crear un proyecto, ejecuta init primero.
No se migran ni borran bases o configuraciones antiguas automáticamente.
PostgreSQL todavía no está disponible. No hay copia local alternativa ni sincronización.
Las consultas son literales; todas las palabras deben coincidir.
En búsqueda all, un tema activo del proyecto sustituye al mismo tema shared.
El recuerdo compartido se conserva y se puede consultar con --scope shared.
Actualizar un tema requiere --expected-version. Archivar conserva el historial.
Los resultados son JSON; errores a stderr y código de salida 1, sin conexiones privadas.
save es manual/programático; la integración memory_save con asistentes está pendiente.
```

> [!NOTE]
> **Modo de desarrollo en el repositorio:** Si estás desarrollando o probando cambios directamente en el código fuente, puedes utilizar `bun run cli <comando>` para ejecutar el CLI al instante sin tener que compilarlo previamente.

---

## 5. El Espacio Central de Usuario: Una Sola Configuración y Una Sola Base

Forge614 Engram utiliza un **único espacio central de almacenamiento** ubicado en la carpeta personal de tu usuario (`~`):

```text
~/.forge614/
  ├── .env          (archivo de configuración global único)
  ├── engram.db     (única base de datos SQLite con todos los recuerdos)
  ├── engram.db-wal (diario de transacciones rápidas WAL)
  └── engram.db-shm (índice de memoria compartida para concurrencia)
```

### Reglas Clave de Almacenamiento
1. **Un solo archivo de configuración (`~/.forge614/.env`):**
   No existen archivos `.env` dispersos por proyecto ni carpetas `projects/<ID>`. Su contenido se genera automáticamente:
   ```dotenv
   FORMAT_VERSION="2"
   STORAGE="sqlite"
   ```
   El lector interno acepta exactamente esas dos claves entre comillas dobles (con escapes JSON), líneas vacías y comentarios que comiencen con `#`. No evalúa órdenes de terminal (*shell*), no expande variables y no carga estas claves en `process.env`.
2. **Permisos y Seguridad Estricta:**
   La carpeta `~/.forge614/` se crea con permisos `0700` (acceso exclusivo para el usuario propietario). El archivo `.env` y la base de datos `engram.db` se crean en modo `0600` (lectura y escritura solo para el dueño). Antes de abrir SQLite, el programa comprueba el propietario y rechaza enlaces simbólicos (*symlinks*), enlaces duros (*hard links*) y tipos especiales de archivo.
3. **Independencia del directorio de trabajo:**
   No importa si ejecutas el comando desde el escritorio, desde la raíz del sistema o desde cualquier carpeta de código: el programa siempre se comunica con el mismo espacio central `~/.forge614/`.
4. **Banderas descartadas:**
   Las opciones `--db`, `--project` y `--id-project` **no existen**. El identificador único de proyecto se llama exactamente `projectId`.

---

## 6. Primeros Pasos: Inicializar, Crear Proyecto y Guardar Recuerdos

### Paso 1: Inicializar el Espacio de Memoria (`init`)
El comando `init` prepara la configuración y la base de datos de manera atómica y segura:

```bash
forge614-engram init
```

**Respuesta JSON:**
```json
{
  "initialized": true,
  "storage": "sqlite"
}
```
*(Nota: `init` es repetible. Si el espacio ya está configurado y la base es válida, confirma el estado sin reiniciar ni borrar tus datos).*

---

### Paso 2: Registrar tu Primer Proyecto (`project-create`)
Crea un proyecto asignándole un nombre legible:

```bash
forge614-engram project-create --name "Mi aplicación"
```

**Respuesta JSON:**
```json
{
  "projectId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "name": "Mi aplicación",
  "createdAt": "2026-09-16T20:00:00.000Z",
  "updatedAt": "2026-09-16T20:00:00.000Z"
}
```

> [!IMPORTANT]
> El sistema te devuelve un identificador único universal (`projectId`). **Copia ese UUID para tus operaciones siguientes**. El nombre del proyecto es solo una etiqueta visual; todas las operaciones sobre ese proyecto exigirán su `projectId`.

Puedes consultar todos tus proyectos registrados en cualquier momento con:
```bash
forge614-engram project-list
```

---

### Paso 3: Guardar tu Primer Recuerdo de Proyecto (`scope: project`)
Por defecto, el comando `save` guarda en el alcance del proyecto especificado (requiere `--project-id`):

```bash
forge614-engram save --project-id 7c9e6679-7425-40de-944b-e07fc1f90ae7 --title "Base de datos" --content "Usaremos SQLite localmente" --type decision --topic architecture/database
```

**Respuesta JSON:**
```json
{
  "id": "a3b1c2d3-e4f5-4678-8901-abcdef012345",
  "projectId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "scope": "project",
  "topicKey": "architecture/database",
  "type": "decision",
  "title": "Base de datos",
  "content": "Usaremos SQLite localmente",
  "pinned": false,
  "version": 1,
  "state": "active",
  "createdAt": "2026-09-16T20:01:00.000Z",
  "updatedAt": "2026-09-16T20:01:00.000Z"
}
```

---

### Paso 4: Guardar un Recuerdo Compartido Universal (`scope: shared`)
Si tienes una regla o preferencia general que aplica a todos tus proyectos (por ejemplo, tu idioma preferido), guárdala como recuerdo compartido con `--scope shared` (no admite `--project-id`):

```bash
forge614-engram save --scope shared --title "Idioma preferido" --content "Prefiero explicaciones en español" --type preference --topic preferences/language
```

**Respuesta JSON:**
```json
{
  "id": "f1e2d3c4-b5a6-4789-9012-3456789abcde",
  "projectId": null,
  "scope": "shared",
  "topicKey": "preferences/language",
  "type": "preference",
  "title": "Idioma preferido",
  "content": "Prefiero explicaciones en español",
  "pinned": false,
  "version": 1,
  "state": "active",
  "createdAt": "2026-09-16T20:02:00.000Z",
  "updatedAt": "2026-09-16T20:02:00.000Z"
}
```

---

## 7. Aclaración Fundamental: Guardado Manual vs. Asistentes de IA

<callout icon="ℹ️" color="blue_bg">
**Estado actual de la entrega:** El sistema guarda **única y exclusivamente bajo demanda explícita**. Hoy esa orden proviene de que tú escribas el comando en la terminal o de que un script invoque el SDK en TypeScript.
</callout>

### ¿Cuándo guardará el asistente por sí mismo?
La integración para que un asistente de inteligencia artificial (como Claude, Cursor o Antigravity) reconozca aprendizajes y los guarde autónomamente mediante herramientas del protocolo MCP (*Model Context Protocol*) usando una función como `memory_save` forma parte de la **Etapa 3 de la hoja de ruta pendiente**.

En la versión actual, el comando manual sirve para inspección, pruebas, inicialización y registro directo de conocimientos. No esperes ni configures guardados automáticos invisibles en esta etapa.
