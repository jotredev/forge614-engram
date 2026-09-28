# Entrega 06 — Configuración global interactiva

> Versión corregida por decisión del usuario: setup NO administra proyectos.
> Sustituye el borrador anterior con menú crear/elegir/continuar sin proyecto.

## Implementado

- Programa 0.3.0, formato de configuración 2, esquema SQLite 3,
  application_id 1177956660. No hay migración nueva.
- `forge614-engram setup` explica y prepara una única configuración
  `~/.forge614/.env` y base `~/.forge614/engram.db`.
- No pide proyecto, no lista proyectos, no crea ni selecciona ninguno.
  La configuración global sirve desde cualquier carpeta.
- Valida una instalación existente en modo de solo lectura antes de preguntar.
  Después de confirmar vuelve a validar mediante el init existente.
- Muestra resumen y pregunta únicamente `¿Confirmar? [si/NO]:`.
  Acepta si/sí/s/yes/y sin distinguir mayúsculas. Enter/no/n cancelan;
  otras respuestas vuelven a preguntar. q/cancelar/EOF/Ctrl+C cancelan.
- Antes de confirmar no crea configuración ni modifica proyectos o recuerdos.
  Una cancelación en un espacio nuevo no crea la carpeta.
- Éxito 0; cancelación 130; error 1. setup muestra texto para personas.
  Sin entrada y salida TTY falla con INTERACTIVE_REQUIRED en JSON a stderr.
  Los demás comandos conservan JSON y no requieren interacción.
- No acepta opciones de proyecto, almacenamiento, credenciales ni --yes.
  init y los comandos project-* siguen disponibles como herramientas
  manuales/programáticas, pero no son pasos obligatorios del setup.
- La instalación del ejecutable sigue separada de la configuración.
  No se conectan asistentes, no se hacen llamadas de red ni se modifican
  .claude/.codex. PostgreSQL no está implementado.

## Seguridad y límites

Una base configurada que falta no se recrea. No se sobrescriben configuraciones,
no se borran recuerdos y no se migran esquemas antiguos automáticamente.
Se conservan las comprobaciones de permisos, propiedad, enlaces y esquema.

Inspeccionar SQLite existente puede implicar manejo normal de archivos auxiliares:
no prometer cero actividad del sistema operativo. Una falla después de confirmar
puede dejar almacenamiento inicializado; no hay una transacción que abarque todos
los archivos y no se borra información como compensación. Ctrl+C posterior a
confirmar no es una operación de deshacer.

Se conserva el ajuste de inicialización WAL: una transacción vacía tras activar
WAL al crear el esquema permite abrir inmediatamente la base en modo de solo
lectura con Bun 1.3.8/macOS, incluso sin proyectos. No cambia tablas ni versiones.
Los archivos auxiliares no son bases independientes.

## Política aprobada para la FUTURA integración, aún no implementada

- El alcance predeterminado será el proyecto identificado mediante projectId.
- shared requiere una intención explícita del usuario de aplicación global,
  por ejemplo «en todos mis proyectos» o «regla global».
- El asistente interpretará contexto, autoría, citas, preguntas y decisiones
  confirmadas; no se limitará a detectar palabras clave.
- «Siempre» dentro de un proyecto no basta para convertir un recuerdo en shared.
- No se promoverán recuerdos a shared por repetición o aparente utilidad.
- Sin proyecto identificado, no se asignará shared como alternativa automática:
  lo ambiguo requiere aclaración, no inventar un projectId o alcance.
- El registro/detección automática del proyecto queda pendiente con memory_save/MCP.
  No atribuir esa automatización a setup ni a la base de datos por sí sola.
- La API actual ya usa scope project por defecto y exige shared explícito.
  Esto NO equivale a haber implementado la interpretación del lenguaje natural.

## Archivos y verificación

- src/setup.ts: explicación, validación, confirmación e inicialización global.
- src/setup-terminal.ts: readline, cancelación, EOF y entradas en ráfaga.
- src/cli.ts: despacho y ayuda; src/schema.ts: ajuste WAL mencionado.
- tests/setup.test.ts: una sola confirmación, ausencia de proyectos nuevos,
  conservación de datos existentes, cancelación y base faltante.
- tests/setup-terminal.test.ts: procesos hijo con readline real y capacidad TTY
  simulada para EOF/Ctrl+C/respuestas pegadas; no confundir con PTY real.
- tests/cli.test.ts: sin TTY, flags inválidos y compatibilidad de init.
- No se modificó el almacenamiento real del usuario. No hay commit ni push.
- Verificación de esta corrección: 75 pruebas, 0 fallos, 563 aserciones en
  9 archivos (Bun 1.3.8/macOS); typecheck y git diff --check correctos.
  Revisión independiente del flujo corregido sin hallazgos importantes.

## Prompt para documentación y Notion

```text
Actualiza la documentación de Forge614 Engram para la Entrega 06 corregida.

Lee docs/handoffs/06-interactive-setup.md, el código y las pruebas allí indicados.
Este handoff sustituye cualquier descripción previa de setup con creación o
selección de proyectos. El código vigente es la fuente de verdad.

Mantén docs/es/ y docs/en/ separadas, completas y equivalentes, con índices 01–08.
Usa lenguaje cotidiano y explica términos técnicos entre paréntesis. Integra
el cambio en instalación, recorrido, CLI, errores, glosario, arquitectura y roadmap.

Documenta que setup únicamente explica, valida y configura el almacenamiento
global con una confirmación. No pregunta ni crea ni selecciona proyectos.
Actualiza ejemplos: ejecutar setup → leer rutas/resumen → confirmar si o cancelar.
Explica los códigos 0/130/1, INTERACTIVE_REQUIRED, TTY, EOF/Ctrl+C y que setup
muestra texto mientras los otros comandos conservan JSON.
Los comandos project-* permanecen en la referencia, pero no son pasos obligatorios
de instalación. No inventes detección de carpetas ni vinculación con asistentes.

Mantén la versión 0.3.0, configuración 2 y esquema 3. Explica la corrección de
inicialización WAL sin presentarla como cambio de esquema o migración.
Respeta los límites de seguridad y cancelación del handoff.

Distingue explícitamente política aprobada pendiente e implementación:
la futura integración guardará por projectId por defecto; shared exige intención
explícita de alcance global, interpretada en contexto. No bastan «siempre», repetición
o ausencia de proyecto. Aún no existe clasificador automático ni memory_save/MCP.

Quedan cuatro fases: PostgreSQL global, integración memory_save/MCP, mejoras
matemáticas de recuperación y TUI. El setup básico global ya está implementado.

Actualiza Notion en ambos idiomas si tienes acceso, preservando la jerarquía.
Si no hay acceso, reporta qué quedó pendiente sin afirmar sincronización.
No modifiques código, pruebas, configuración del usuario ni hagas commit/push/PR.
Verifica ejemplos con directorios temporales. Ejecuta bun test,
bun run typecheck y git diff --check docs/ y reporta resultados reales.
```
