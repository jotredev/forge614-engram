# Prompt para actualizar documentación — instalación y guardado

Actualización: el encargo 03 sustituye la ubicación de base de datos descrita
en este documento. Ahora CLI y SDK sin ruta usan `~/.forge614/engram.db`.

Este encargo complementa el de la etapa 1. Las instrucciones de instalación
anteriores que presentaban `bun run cli` como uso normal quedan reemplazadas.
No se implementaron MCP ni guardado iniciado por asistentes en este cambio.

---

Actualiza la documentación de Forge614 Engram en `docs/es/` y `docs/en/`,
manteniendo equivalencia entre idiomas. Actualiza las páginas correspondientes
en Notion si tienes conexión y página autorizada; si no, entrega los archivos
locales y reporta publicación pendiente. No cambies el código del producto.

El usuario quiere explicaciones para cualquier persona: primero lenguaje simple,
después término técnico entre paréntesis. Separa tres lectores: usuario del comando,
persona que conecta un asistente y programador que integra una aplicación.

## Cambios reales que debes reflejar

1. Existe `scripts/install.sh`: instala desde una copia local del repositorio,
   sin publicación ni instalación mediante npm. Compila un ejecutable autónomo
   llamado `forge614-engram` utilizando `bun build --compile`.
2. Bun estable >=1.3.8 es requisito para construir/instalar desde código; no hace
   falta Bun ni Node en PATH para usar después el ejecutable. No hace falta ejecutar
   `bun install` para este instalador; ese comando instala herramientas de desarrollo.
3. Destino predeterminado: `$HOME/.local/bin/forge614-engram`. Otra carpeta:
   `bash scripts/install.sh --bin-dir /ruta/a/bin`. No crea alias `engram`.
4. El instalador no modifica archivos de configuración de terminal. Si la carpeta
   no está en PATH, muestra la línea de configuración apropiada para Bash/Zsh.
   Explica que PATH es la lista de carpetas donde la terminal busca programas.
5. Rechaza reemplazar un destino existente a menos que se indique `--force`.
   Compila antes de reemplazar; reemplaza el ejecutable sin modificar recuerdos.
6. El comando admite `forge614-engram --version` sin abrir base. `help` usa el
   nombre instalado y avisa que save es manual y la integración sigue pendiente.
7. `bun run cli` se conserva como acceso de desarrollo, no como instalación final.

## Flujo de instalación que debes comprobar

Desde un checkout que contenga estos cambios:
    bash scripts/install.sh
    export PATH="$HOME/.local/bin:$PATH"
    forge614-engram --version
    forge614-engram help

Para obtener código desde GitHub, el repositorio es
https://github.com/jotredev/forge614-engram.
No asegures que el instalador está publicado en main: comprueba la rama o etiqueta
disponible antes de dar comandos de clonación. Los cambios se desarrollan en
feat/local-memory-foundation; al redactar este encargo estaban sin commit/push.
No crees una etiqueta, release ni push como parte de documentar.
No inventes un instalador remoto curl ni descargas de releases: no existen aquí.

Actualización: obtener el checkout deseado y ejecutar de nuevo el instalador con
`--force`, y la misma opción --bin-dir si se usó una ubicación personalizada.
No presentar reinstalar el ejecutable como actualizar Bun automáticamente.
No afirmar compatibilidad probada con Windows. El script acepta macOS y Linux
con Bash; la verificación real disponible es macOS. Linux aún requiere validación.

## Aclaración central: ¿se guarda automáticamente?

Estado actual: el motor guarda cuando recibe una orden. Hoy esa orden puede venir
del comando manual `forge614-engram save` o de una aplicación que llama `store.save`.
La persistencia física del archivo la realiza el programa; no hay que guardar
manualmente un archivo SQLite ni arrancar un servidor de bases de datos.

Comportamiento deseado, confirmado por el usuario: el asistente reconocerá y guardará
decisiones, soluciones y aprendizajes importantes mientras se trabaja. El usuario
no debería escribir save cada vez. No se pretende almacenar toda la conversación.

Ese comportamiento NO está implementado todavía. Requiere conexión con el asistente
(MCP), reglas de cuándo guardar/consultar y pruebas de integración. Solo añadir
un servidor MCP no prueba que un asistente consulte o guarde memoria por sí mismo.
No prometas «todo se guarda automáticamente» ni ocultes la etapa pendiente.
El comando manual seguirá sirviendo para inspección, pruebas y guardado explícito.

También se desea que la memoria mejore con el uso: identificar conocimiento útil,
revisar lo obsoleto, resolver contradicciones y recuperar mejor. Eso es evolución
del conocimiento almacenado y su recuperación; no entrenamiento del modelo.
Feedback, recuperación semántica, RRF/MMR y evaluación comparativa siguen pendientes.
No afirmar que ya supera a Gentleman o Softmax. Esa superioridad debe medirse.

## Explicar qué significa MemoryStore

    const store = new MemoryStore("./.forge614/app-memory.sqlite");

Es código dirigido a programadores, no un paso de instalación del usuario.
Significa «abre el archivo app-memory.sqlite para que mi aplicación pueda guardar
y consultar recuerdos; créalo si no existe». La ruta es un ejemplo elegido por
esa aplicación. No es un servicio web, no es PostgreSQL y no configura una base remota.

La CLI continúa usando `.forge614/memory.sqlite` relativa al directorio de ejecución,
salvo --db. No cambió a una base global al instalar el comando. Ejecutar desde otra
carpeta puede abrir otra base; una ruta absoluta mediante --db permite compartir
un archivo entre directorios. Distingue ubicación del ejecutable y ubicación de datos.
No se migraron archivos existentes ni se modificó el esquema de recuerdos.

No es necesario escribir MemoryStore para usar el comando instalado; deja los
ejemplos TypeScript exclusivamente en la sección para programadores (SDK).

## Ejemplo manual correcto

    forge614-engram save --project demo --title "Base de datos" --content "Usamos SQLite localmente" --type decision
    forge614-engram search --project demo --query SQLite

Identificarlo como prueba manual de funcionamiento, no como el futuro flujo cotidiano
con un asistente. Guarda y verifica ejemplos en una carpeta temporal o con --db temporal.

## Errores adicionales encontrados en las guías actuales

- Revisar enlaces de traducción: hay rutas inexistentes como
  `../en/01-installation-and-01-instalacion-y-primeros-pasos.md` y
  `../en/04-typescript-04-sdk-typescript.md`. Resolver contra nombres reales.
- En la guía SDK, si el archivo está en scratch/example.ts, `./src/index` apunta
  a scratch/src/index y falla. Usar `../src/index` o situar el ejemplo en la raíz.
- El ejemplo SDK actual cambia SQLite por un contenido que solo menciona
  PostgreSQL y luego espera encontrar SQLite al restaurar. Restore solo cambia
  visibilidad, no revierte el texto: corregir consulta/contenido y expectativas.
- No afirmar que Linux fue probado si solo existe evidencia de macOS.
- No describir WAL como escrituras sin bloqueo: SQLite sigue serializando escritores.

## Fuentes y comprobación

Lee `scripts/install.sh`, `src/cli.ts`, `package.json`, `src/store.ts`,
`tests/install.test.ts` y `tests/cli.test.ts`. El código manda sobre este resumen.
Las pruebas del instalador construyen un binario real, lo ejecutan fuera del
repositorio con un PATH que contiene solo su carpeta y verifican persistencia.
También verifican rechazo de sobrescritura, actualización explícita, falta de Bun,
ayuda y argumentos incorrectos. Ejecuta bun test y bun run typecheck para informar
el estado vigente. No instales globalmente en el equipo del usuario al documentar:
usa --bin-dir dentro de una carpeta temporal.

Entrega lista de páginas modificadas, enlaces de Notion realmente actualizados,
ejemplos verificados y pendientes. Conserva el contenido correcto previo; actualiza
todos los ejemplos de uso normal al nuevo comando en ambos idiomas.
