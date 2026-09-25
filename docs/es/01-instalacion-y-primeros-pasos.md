# 01. Instalación y Primeros Pasos

## Sistemas soportados

Los releases oficiales soportan actualmente macOS y Linux. El instalador descarga el binario correspondiente, lo valida contra `SHA256SUMS` y lo instala en `~/.forge614/engram/bin/`. Si Forge614 Engines falta, instala su dependencia desde un release verificado. Windows todavía no tiene distribución publicada.

## Instalar

```bash
curl -fsSL https://github.com/jotredev/forge614-engram/releases/latest/download/install.sh | bash
```

Abre una terminal nueva y verifica:

```bash
forge614-engram --version
forge614-engram help
```

El instalador solo crea o repara el directorio propio de Engram y la ruta del ejecutable. Nunca inicializa una base, crea recuerdos ni configura en silencio un cliente de IA.

## Inicializar la memoria

Engram usa una única base para todos los proyectos:

```text
~/.forge614/engram/.env
~/.forge614/engram/engram.db
```

## Raíz de almacenamiento alternativa

`FORGE614_HOME` funciona como la dirección de un edificio: todo lo que pertenece a Engram —`.env`, SQLite, binario y archivos auxiliares— queda dentro de esa misma raíz. Si la variable no está definida, la dirección histórica sigue siendo exactamente `~/.forge614`; si está definida, debe ser una ruta absoluta.

```bash
FORGE614_HOME=/ruta/absoluta/forge614 forge614-engram init --json
```

Con ese ejemplo, la configuración y la base quedan en `/ruta/absoluta/forge614/engram/`. Una variable vacía o relativa falla antes de crear o leer almacenamiento: stdout queda vacío, stderr devuelve `{"code":"INVALID_FORGE614_HOME","error":"…"}` y el proceso termina con código `1`. No se sustituye silenciosamente por el hogar real.

Para inicialización interactiva de memoria en terminal:

```bash
forge614-engram init
```

Para automatización sin TTY:

```bash
forge614-engram init --json
```

Para configurar una réplica PostgreSQL opcional durante inicialización no interactiva:

```bash
forge614-engram init --json --postgres-url 'postgresql://user:password@host/database'
```

La URL no aparece en salida normal ni errores estructurados. SQLite y FTS5 siguen locales incluso con PostgreSQL configurado.

`init` no crea/selecciona proyectos ni detecta/configura clientes de IA. Solo prepara la memoria y la sincronización PostgreSQL opcional. Una base nueva nace con la memoria inteligente (incluye sesiones y refuerzo); en una base existente sin refuerzo, el `init` de terminal sigue preguntando, y la memoria inteligente se activa con `intelligence-enable` (capítulo 05).

## Crear y usar un proyecto

```bash
forge614-engram project-create --name "Mi aplicación"
forge614-engram project-list
forge614-engram save --project-id <UUID> --title "Base de datos" --content "Usar SQLite local" --topic architecture/database
forge614-engram search --project-id <UUID> --query "SQLite"
```

Los recuerdos compartidos no tienen dueño de proyecto:

```bash
forge614-engram save --scope shared --title "Convención" --content "Usar conventional commits"
forge614-engram search --scope shared --query "conventional"
```

## MCP y trabajo diario con IA

Inicia el servidor local por `stdio` con `forge614-engram mcp`. La detección y configuración de clientes de IA no pertenecen a Engram: son responsabilidad de Forge614 Engines y Shell. Tras configurar una integración mediante sus contratos públicos, puedes trabajar en ADE Orca, Claude Code, Codex u otro entorno nativo sin mantener Shell abierto.

## Actualizar y desinstalar

El modo normal es para una persona en terminal y muestra el progreso del instalador. `--json` es para otra herramienta que necesita entender el resultado sin interpretar texto ni progreso.

```bash
forge614-engram update
forge614-engram update --json
forge614-engram uninstall --confirm 'REMOVE FORGE614-ENGRAM'
```

`update` descarga el instalador estable más reciente, verifica el release y reemplaza solo el ejecutable de Engram, mostrando el progreso habitual. Usa la misma raíz efectiva que Engram e instala en `FORGE614_HOME/engram/bin/` cuando la variable está definida; sin ella conserva `~/.forge614/engram/bin/`. `update --json` no muestra ese progreso y, si termina correctamente, escribe únicamente un JSON compacto: `{"updated":true,"previousVersion":"<versión anterior>","installedVersion":"<versión instalada>"}`. Si la versión instalada no cambió, `updated` es `false`.

Ambos modos conservan `.env`, `engram.db`, recuerdos y configuración. En `--json`, un fallo devuelve solamente `{"code":"UPDATE_FAILED","error":"No se pudo actualizar Forge614 Engram."}` por stderr y código `1`; no expone diagnósticos del instalador, URLs ni secretos. Esta interfaz está disponible desde la release estable `v1.4.0`.

Si existe Atlas, la desinstalación exige `REMOVE FORGE614-ENGRAM AND FORGE614-ATLAS` y elimina solamente esos dos directorios.
