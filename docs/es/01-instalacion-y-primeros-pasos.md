# Instalación y Primeros Pasos

> **Etapa:** Etapa 1 — Memoria Local  
> **Estado:** Vigente y Activo  
> **Traducción hermana:** [English Version](../en/01-installation-and-01-instalacion-y-primeros-pasos.md)

Esta guía te explica qué necesitas para ejecutar Forge614 Engram en tu computadora y cómo guardar tu primera memoria en menos de dos minutos.

---

## 1. ¿Qué es este programa y qué necesitas antes de empezar?

Forge614 Engram es un programa privado desarrollado en **TypeScript** (un lenguaje de programación con tipado estricto) que se ejecuta utilizando **Bun** (un entorno moderno y ultrarrápido para ejecutar código sin necesidad de configurar compiladores pesados).

### Requisitos del Sistema

1. **Bun (versión 1.3.8 o superior):**
   - Para verificar si ya tienes Bun instalado, abre tu ventana de comandos (terminal) y escribe:
     ```bash
     bun --version
     ```
   - Si no lo tienes instalado, puedes instalarlo siguiendo las instrucciones oficiales en [bun.sh](https://bun.sh).
2. **Sistema Operativo:**
   - Probado y verificado en **macOS** y entornos tipo Unix (Linux).
3. **Paquete privado:**
   - Este proyecto es una librería privada dentro de este repositorio. No intentes instalarlo desde el registro público de npm (`npm install forge614-engram` no existe). Requiere ejecutarse con Bun directamente desde la carpeta del proyecto.

---

## 2. Preparar el Proyecto (Instalación de Dependencias)

Desde la raíz de la carpeta del repositorio (`/Users/jorgeetrejoo/Desktop/forge614-engram`):

```bash
bun install
```

### ¿Qué hace este comando?
Descarga las definiciones internas de tipos necesarias para el desarrollo. Forge614 Engram **no tiene dependencias de ejecución externas**: la base de datos interna (SQLite) viene incluida directamente dentro de Bun (`bun:sqlite`), por lo que no necesitas instalar servidores de bases de datos, contenedores de Docker ni paquetes pesados.

---

## 3. Verificar el Funcionamiento: El Comando de Ayuda

Antes de guardar cualquier dato, puedes consultar el manual de comandos integrado ejecutando:

```bash
bun run cli help
```

### Resultado en pantalla:
```text
Forge614 Engram — memoria personal local (etapa 1)

Uso: bun run cli <comando> --project <proyecto> [opciones]

save     --title <título> --content <texto> [--type fact|decision|procedure|warning|preference]
         [--topic <tema>] [--expected-version <versión>] [--request-key <clave>]
         [--pinned true|false]
search   --query <texto> [--limit <1..100>]
get      --id <identificador>
history  --id <identificador>
archive  --id <identificador>
restore  --id <identificador>
help     Muestra esta ayuda sin crear archivos.

Todos los comandos de datos aceptan --db <ruta>.
Ruta predeterminada: .forge614/memory.sqlite, relativa al directorio de ejecución.
Las consultas son literales; todas las palabras deben coincidir.
Actualizar un tema existente exige --expected-version. No hay borrado definitivo.
Los resultados son JSON. Los errores van a stderr y devuelven código de salida 1.
```

> [!NOTE]
> **Garantía de limpieza:** El comando `help` y cualquier comando con argumentos incorrectos terminan de inmediato sin crear carpetas ni tocar el disco duro.

---

## 4. Tu Primer Recuerdo Guardado

Vamos a guardar tu primer recuerdo en un proyecto llamado `demo`:

```bash
bun run cli save --project demo --title "Base de datos" --content "Usamos SQLite localmente" --type decision --topic architecture/database --request-key demo-v1
```

### ¿Qué significa cada parte de este comando?
- `bun run cli save`: La orden de guardar una nota en la memoria.
- `--project demo`: La carpeta o gaveta organizadora. Todos los datos se aíslan bajo este nombre.
- `--title "Base de datos"`: El encabezado o resumen de la nota.
- `--content "Usamos SQLite localmente"`: El texto o explicación detallada.
- `--type decision`: La categoría conceptual (en este caso, una decisión tomada).
- `--topic architecture/database`: Una clave temática que agrupa esta decisión para poder actualizarla ordenadamente en el futuro.
- `--request-key demo-v1`: Una clave única de envío (idempotencia) que asegura que si este comando se reintenta por error de red o script, no se cree un duplicado.

### Resultado en pantalla (formato JSON):
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

### ¿Qué cambió en tu computadora tras este comando?
En la carpeta donde ejecutaste el comando, el sistema creó automáticamente una subcarpeta oculta llamada `.forge614/` y dentro de ella el archivo `memory.sqlite`.
- `memory.sqlite`: El archivo principal de la base de datos donde se guardan las memorias y sus versiones.
- `memory.sqlite-wal` y `memory.sqlite-shm`: Archivos temporales de escritura rápida que SQLite utiliza para permitir lecturas y escrituras ultrarrápidas sin bloquearse (modo WAL).

---

## 5. Próximos Pasos

- Para ver cómo actualizar esta nota, buscarla por texto o archivarla, continúa con el [**Recorrido Guiado del Sistema (`02-recorrido-guiado.md`)**](02-recorrido-guiado.md).
- Si quieres conocer todas las opciones y banderas disponibles en la terminal, consulta la [**Referencia de Terminal (`03-referencia-cli.md`)**](03-referencia-cli.md).
- Si eres desarrollador y deseas usar la memoria desde tu propio código TypeScript, consulta la [**Guía del SDK (`04-sdk-typescript.md`)**](04-sdk-typescript.md).
