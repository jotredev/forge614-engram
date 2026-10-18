# 01. Instalación y Primeros Pasos

## Sistemas soportados

Los releases oficiales soportan macOS, Linux y Windows x64. El instalador único descarga y valida el binario contra `SHA256SUMS`, y lo instala en `~/.forge614/engram/bin/` (en Windows, `%USERPROFILE%\.forge614\engram\bin\`). También instala Forge614 Shell y Forge614 Engines cuando faltan. Windows arm64 queda pendiente.

## Requisitos

El instalador necesita **Node.js 22.19.0 o más nuevo**. Si falta o la versión es anterior, explica cómo instalarlo y termina antes de modificar archivos. El requisito también aplica al actualizar o desinstalar desde el instalador único.

## Instalar

```bash
curl -fsSL https://github.com/jotredev/forge614-engram/releases/latest/download/install.sh | bash
```

En Windows x64, abre PowerShell y ejecuta:

```powershell
curl.exe -fsSL -o install.ps1 https://github.com/jotredev/forge614-engram/releases/latest/download/install.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
Remove-Item install.ps1
```

`-ExecutionPolicy Bypass` solo afecta el proceso que ejecuta el instalador; no cambia la política persistente del equipo. El instalador publica el directorio de Engram en el PATH de usuario. Abre una terminal nueva antes de ejecutar `forge614-engram`.

El instalador verifica los porteros, el instalador y la ficha usando `SHA256SUMS`, instala las dependencias declaradas que falten y coloca Engram. La ficha limita los binarios a macOS arm64/x64, Linux arm64/x64 y Windows x64.

Al terminar te dice el siguiente paso con la ruta absoluta (por defecto es la de abajo; si definiste `FORGE614_HOME`, es la misma ruta dentro de esa carpeta). Abre una terminal nueva y ejecútalo:

```bash
~/.forge614/shell/bin/forge614-shell init --product engram
```

Ese comando ya incluye inicializar la memoria de Engram, dentro de sus propias pantallas guiadas, y necesita una terminal interactiva (por eso el instalador solo lo imprime), así que no hace falta ejecutar `forge614-engram init` por separado. Después verifica:

```bash
forge614-engram --version
forge614-engram --version --json
forge614-engram help
```

El instalador solo crea o repara los directorios propios de Engram, Shell y Engines, y la ruta del ejecutable (el instalador de Shell también agrega su propia línea de PATH a tu perfil de terminal). Nunca inicializa una base, crea recuerdos ni configura en silencio un cliente de IA.

## Inicializar la memoria

Engram usa una única base para todos los proyectos:

```text
~/.forge614/memory/.env
~/.forge614/memory/engram.db
```

Los respaldos también viven en `memory/`. En la primera ejecución de 1.10.0, Engram busca la base de 1.9.0 en `engram/`, comprueba que ninguna otra aplicación la tenga abierta, vacía el WAL, verifica una copia temporal y la publica en `memory/`. Si la base sigue abierta, la usa desde la ruta anterior y vuelve a intentar el traslado en la próxima ejecución. Si ya hay una base en `memory/`, esa ubicación tiene prioridad.

## Raíz de almacenamiento alternativa

`FORGE614_HOME` contiene el programa en `engram/` y los datos duraderos en `memory/`. Si la variable no está definida, la raíz es `~/.forge614`; si está definida, debe ser una ruta absoluta.

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

## Usar la misma memoria en otra Mac

Si trabajas desde dos Mac, puedes hacer que las dos vean exactamente los mismos recuerdos (los de tus proyectos, tu libreta personal y el tablero del ecosistema), sin usarlas al mismo tiempo. Sin esto activado, Engram funciona exactamente igual que siempre: nada cambia hasta que lo prendas.

**1. Crea un proyecto en Neon.** [Neon](https://neon.tech) es un servicio de PostgreSQL en la nube; crea una cuenta y un proyecto nuevo dedicado solo a Engram (cualquier región cercana sirve; Engram admite PostgreSQL 16 a 18). Neon te da una dirección de conexión: cópiala tal cual, con `sslmode=require&channel_binding=require`, con o sin `-pooler` en el host. Si quieres ensayar antes, Neon deja crear una rama de prueba con su propia dirección, que puedes borrar al terminar.

Esa dirección es una llave: nunca la pegues en un chat ni la guardes en un archivo del repositorio. Los comandos de este capítulo la piden en la terminal sin mostrarla en pantalla, y la guardan solo en `~/.forge614/engram/.env`, con permisos que solo tú puedes leer. Por ejemplo: `postgresql://<usuario>:<contraseña>@<host>/neondb?sslmode=require&channel_binding=require`.

**2. Instala 1.8.0 y cierra todas las sesiones.** Actualiza Engram en las dos Mac (`forge614-engram update`). Una base ya preparada para la nube no la puede abrir una versión anterior a 1.8.0 (responde `DATABASE_VERSION`), así que antes de activar la nube cierra cualquier sesión de terminal, IA o servidor MCP que todavía use Engram en esa Mac.

**3. Activa la nube en la primera Mac.**

```bash
forge614-engram cloud on
```

Sin `--postgres-url`, el comando te pide la dirección en la terminal (no se muestra al escribirla) y la prueba conectándose antes de guardar nada. La primera vez que se activa, sube a Neon toda la memoria que ya tenías en esa Mac.

**4. Activa la nube en la segunda Mac, con la MISMA dirección.**

```bash
forge614-engram cloud on
```

Esta Mac también activa la nube por primera vez: sube toda su memoria local que viaja y baja desde el cambio 0 lo que subió la primera Mac. Si esta Mac ya tenía memoria propia, las dos terminan con la suma de ambas (en segundo plano, o de inmediato con `forge614-engram sync`).

**5. Confirma el estado en las dos.**

```bash
forge614-engram cloud status --json
```

Cuando `pending` sea `0` en ambas, las dos Mac tienen la misma memoria. A partir de aquí, cada guardado se sincroniza solo, sin comandos: mientras Engram esté abierto, sube y baja cambios cada 30 segundos y también justo después de guardar. Si te quedas sin internet, lo pendiente espera en una cola local y sale en cuanto vuelva la conexión, sin perder nada. Consulta el capítulo [05. Arquitectura Interna y Fórmulas](05-arquitectura-interna-y-formulas.md) para cómo funciona por dentro y el capítulo [03. Referencia CLI](03-referencia-cli.md) para el resto de `cloud on/off/status`.

## MCP y trabajo diario con IA

Inicia el servidor local por `stdio` con `forge614-engram mcp`. La detección y configuración de clientes de IA no pertenecen a Engram: son responsabilidad de Forge614 Engines y Shell. Tras configurar una integración mediante sus contratos públicos, puedes trabajar en Claude Code, Codex u otro entorno nativo sin mantener Shell abierto.

## Actualizar y desinstalar

El modo normal es para una persona en terminal y muestra el progreso del instalador. `--json` es para otra herramienta que necesita entender el resultado sin interpretar texto ni progreso.

```bash
forge614-engram update [--version X.Y.Z] [--json]
forge614-engram uninstall [--purge-data] [--json]
forge614-engram uninstall --self [--json]
```

`update` usa el portero de la release seleccionada, comprueba su SHA-256 con `SHA256SUMS` y lee la versión real del lanzador después de instalar. En macOS y Linux, actualizar desde 1.9.0 migra la memoria en un solo paso. En Windows, el primer `update` de 1.9.0 reemplaza el ejecutable por el nuevo formato; el segundo `update`, ya en 1.10.0, migra la memoria automáticamente. Shell lo llama con `update --json`; el resultado conserva `updated`, `previousVersion`, `installedVersion` y el campo opcional `pendingVersion`.

`uninstall` pide una confirmación en terminal y conserva `memory/`. Si Atlas está instalado, la frase nombra a ambos productos y se desinstalan los dos. `--json` y la ejecución sin terminal no preguntan. `--purge-data` requiere terminal y una frase adicional; borra la memoria local y su `.env`, pero no la copia PostgreSQL. `uninstall --self` retira solo las integraciones de Engram que administra Engines, conserva Atlas y se invoca antes de que el instalador borre `engram/`.
