# 01. Instalación, Configuración y Primeros Pasos

> **Etapa:** Etapa 1 — Memoria Local  
> **Estado:** Vigente y Actualizado (Instalador local + Base en directorio de usuario)  
> **Traducción hermana:** [01 (EN). Installation, Setup, and Getting Started](../en/01-installation-and-getting-started.md)

Esta guía explica cómo compilar e instalar el comando `forge614-engram` en tu computadora, cómo funciona la ubicación centralizada de datos del usuario y cómo registrar tu primera memoria en menos de dos minutos.

---

## 1. ¿Qué es este programa y cómo se distribuye?

Forge614 Engram es un sistema de memoria personal desarrollado en **TypeScript**. A diferencia de las librerías públicas de internet, este proyecto es un **paquete privado**:
- No se descarga desde npm (`npm install forge614-engram` no existe).
- Se compila directamente desde una copia local de este repositorio mediante un script de instalación (`scripts/install.sh`).
- Produce un **ejecutable binario independiente** llamado `forge614-engram`. Una vez instalado, dicho ejecutable **no requiere tener Bun ni Node.js en el PATH** para funcionar en el día a día.

### Requisitos del Sistema
1. **Bun (versión estable >= 1.3.8):**  
   Requisito exclusivo para **compilar e instalar** desde el código fuente.
   ```bash
   bun --version
   ```
   Si no lo tienes, instálalo siguiendo las instrucciones de [bun.sh](https://bun.sh).
2. **Sistema Operativo:**  
   Probado y verificado en **macOS**. El script admite entornos macOS y Linux con Bash.

---

## 2. Instalación mediante el Script Autónomo

Desde la raíz del repositorio (`/Users/jorgeetrejoo/Desktop/forge614-engram`):

```bash
bash scripts/install.sh
```

### ¿Qué hace exactamente este instalador?
1. Verifica que tengas Bun >= 1.3.8 para compilar.
2. Ejecuta `bun build ./src/cli.ts --compile` para empaquetar el motor TypeScript, el intérprete y el controlador nativo de SQLite en un solo archivo binario autónomo.
3. Lo instala por defecto en la carpeta de ejecutables de tu usuario:  
   `$HOME/.local/bin/forge614-engram`
4. **Protección contra sobreescrituras accidentales:** Si el archivo ya existe, el script aborta para evitar accidentes. Para actualizar o reinstalar, debes usar la bandera `--force`:
   ```bash
   bash scripts/install.sh --force
   ```
5. **Carpeta personalizada:** Si prefieres instalarlo en otro directorio:
   ```bash
   bash scripts/install.sh --bin-dir /mi/ruta/bin
   ```

---

## 3. Configurar tu Terminal (La Variable PATH)

Para poder escribir `forge614-engram` desde cualquier carpeta sin tener que escribir la ruta completa, tu terminal debe saber dónde buscarlo.

### ¿Qué es el PATH?
El **PATH** es la lista de carpetas que revisa tu sistema operativo cada vez que escribes el nombre de un comando en la terminal.

Si `$HOME/.local/bin` no está en tu PATH, el instalador te mostrará una sugerencia. Para configurarlo en tu sesión actual de Bash o Zsh:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

> [!TIP]
> Si deseas conservar esta configuración permanentemente para que funcione cada vez que abras una nueva ventana de terminal, añade la línea anterior a tu archivo de configuración de usuario (`~/.zshrc` en macOS o `~/.bashrc` en Linux).

---

## 4. Verificar la Instalación

Una vez configurado el PATH, comprueba la versión y la ayuda sin tocar el disco duro:

```bash
# Comprobar la versión instalada (no abre ni crea bases de datos)
forge614-engram --version
# Salida esperada: forge614-engram 0.1.0

# Consultar el manual de ayuda
forge614-engram help
```

### Resultado de `forge614-engram help`:
```text
Forge614 Engram — memoria personal local (etapa 1)

Uso: forge614-engram <comando> --project <proyecto> [opciones]

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
Ruta predeterminada: ~/.forge614/engram.db (base global del usuario).
Las consultas son literales; todas las palabras deben coincidir.
Actualizar un tema existente exige --expected-version. No hay borrado definitivo.
Los resultados son JSON. Los errores van a stderr y devuelven código de salida 1.
save es una operación manual. La integración con asistentes aún está pendiente.
```

> [!NOTE]
> **Modo de desarrollo en el repositorio:** Si estás desarrollando o modificando el código fuente dentro del repositorio, puedes ejecutar `bun run cli <comando>` para probar cambios inmediatamente sin tener que reinstalar el binario.

---

## 5. Dónde Viven tus Recuerdos: La Base Central del Usuario

A diferencia de versiones preliminares que creaban archivos dispersos por proyecto, Forge614 Engram almacena todos los recuerdos en una **base de datos centralizada en la carpeta del usuario**:

$$\sim/\text{.forge614/engram.db}$$

En tu computadora macOS, la ruta absoluta es:
`/Users/jorgeetrejoo/.forge614/engram.db`

### Estructura conceptual en tu máquina:
```text
carpeta del usuario (~/)
  ├── .claude/         (configuración de clientes de IA)
  ├── .codex/          (configuración de asistentes de código)
  ├── .local/bin/      (donde vive el ejecutable forge614-engram)
  └── .forge614/       (almacén central de memoria de Forge614)
        ├── engram.db       (base de datos SQLite con todos los recuerdos)
        ├── engram.db-wal   (diario de escritura rápida concurrente)
        └── engram.db-shm   (índice de memoria compartida)
```

- **Independencia del directorio de trabajo:** Ya sea que ejecutes el comando desde `/Users/jorgeetrejoo/Desktop/proyecto-a` o desde `/Users/jorgeetrejoo/Desktop/proyecto-b`, el sistema abre exactamente el mismo archivo central `~/.forge614/engram.db`.
- **Aislamiento por proyecto:** Dentro de esa base compartida, la bandera obligatoria `--project <nombre>` organiza los recuerdos en gavetas estrictamente separadas. Los recuerdos del proyecto `app-frontend` jamás se mezclarán con los de `api-backend`.
- **Creación bajo demanda:** La carpeta `~/.forge614/` y el archivo `engram.db` se crean automáticamente la primera vez que ejecutas una operación válida de datos (incluso una lectura válida como `search`). Los comandos `help`, `--version` o argumentos inválidos **nunca crean archivos**.

---

## 6. Tu Primer Recuerdo Guardado

Vamos a guardar tu primer recuerdo en el proyecto `demo`:

```bash
forge614-engram save --project demo --title "Base de datos" --content "Usamos SQLite localmente" --type decision --topic architecture/database --request-key demo-v1
```

### Respuesta estructurada en JSON:
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

---

## 7. Aclaración Fundamental: ¿Se Guarda Automáticamente la Memoria?

<callout icon="ℹ️" color="blue_bg">
**Estado actual de la Etapa 1:** El sistema guarda **única y exclusivamente cuando recibe una orden explícita**. Hoy esa orden proviene de que tú escribas `forge614-engram save` en la terminal o de que un programa invoque `store.save(...)`.
</callout>

### ¿Cómo funcionará con los asistentes en el futuro (Etapa 2)?
El objetivo del proyecto es que tu asistente de código (Claude Code, Cursor, Antigravity) reconozca decisiones y soluciones importantes y llame al comando por sí mismo mediante el protocolo **MCP (Model Context Protocol)** o ganchos (*hooks*).

Sin embargo, **esa integración con asistentes NO está implementada todavía**. No prometas ni esperes que el programa "escuche tus chats y guarde todo mágicamente en segundo plano" en esta Etapa 1. Hoy, el comando manual sirve para inspección, pruebas, auditoría y guardado explícito.
