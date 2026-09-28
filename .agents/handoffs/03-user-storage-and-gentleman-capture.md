# Prompt documental — base del usuario y guardado de Gentleman

Actualiza `docs/es/`, `docs/en/` y las páginas correspondientes de Notion
(solo si tienes acceso al destino autorizado). No cambies código. Este encargo
sustituye toda explicación anterior que situaba la base predeterminada dentro
del proyecto. Mantén los cambios del instalador descritos en el encargo 02.

## Cambio implementado

Ahora la base normal se guarda en `~/.forge614/engram.db`.
El símbolo ~ significa la carpeta del usuario, no la carpeta del proyecto.
En el equipo del usuario, la ruta será:
`/Users/jorgeetrejoo/.forge614/engram.db`.
Usa también ejemplos genéricos sin datos personales en las guías públicas.

La estructura conceptual es:

    carpeta del usuario/
      .claude/
      .codex/
      .forge614/
        engram.db

Forge614 usa su propia carpeta; no guarda dentro de .claude o .codex ni necesita
que esas carpetas existan. No confundir la carpeta de datos con ~/.local/bin,
donde se instala el ejecutable.

Al ejecutar desde proyecto A o B se abre el mismo archivo. --project organiza
recuerdos en grupos separados dentro de esa base. No se detecta todavía el
proyecto automáticamente y no se trata de permisos entre usuarios.

CLI y SDK comparten el cálculo de ubicación en `src/paths.ts` mediante
`defaultDatabasePath()`, que obtiene la carpeta del usuario con `homedir()`.
No se añadió una variable de entorno de configuración de datos.

El SDK ahora permite:

    const store = new MemoryStore();

Esto utiliza la misma base que `forge614-engram`. No obliga a un programador
a inventar una ruta. MemoryStore sigue siendo una herramienta de integración;
el usuario normal solo necesita el comando o su futuro asistente conectado.

Las rutas explícitas siguen disponibles como elección avanzada:
- CLI: --db /ruta/aislada/pruebas.sqlite.
- SDK: new MemoryStore('/ruta/aislada/pruebas.sqlite').
- SDK: new MemoryStore(':memory:') para datos efímeros.
No las presentes como el paso normal de instalación ni como bases creadas por proyecto.

La carpeta/archivo se crea cuando una operación de datos válida abre el almacén.
help, --version y argumentos inválidos no crean la base. Se actualizó la ayuda.
Un comando válido de lectura también puede crear una base vacía si no existe.

## Compatibilidad y datos anteriores

No cambió el esquema SQLite. No se movieron, fusionaron ni borraron bases anteriores.
Quien guardó recuerdos en `<proyecto>/.forge614/memory.sqlite` no los verá
automáticamente en la nueva ubicación. Puede seguir consultando ese archivo
mediante --db con su ruta explícita. No hay migrador ni importación implementada.
No recomendar copiar archivos SQLite con escritores activos ni borrar los anteriores.
No afirmar que se creó una base real en el usuario durante nuestras pruebas:
se usaron carpetas temporales y una carpeta de usuario simulada en los procesos
de prueba; no se modificó HOME ni se escribieron recuerdos de prueba en su cuenta.

## Respuesta comprensible: Gentleman no exige guardar manualmente

Gentleman proporciona instrucciones persistentes al asistente para que identifique
decisiones, soluciones y descubrimientos y llame a mem_save sin esperar una petición
explícita. Quien decide el aprendizaje es el propio asistente/modelo ya en uso.
No se necesita un segundo modelo extractor en ese recorrido de mem_save.
Esto consume contexto/herramientas del asistente: no afirmar que no tiene ningún costo.

Algunas integraciones también ejecutan acciones al iniciar sesiones, recibir
mensajes, terminar subagentes o cerrar sesiones (hooks). La cobertura depende
del cliente. El hook SubagentStop de Claude envía el texto a captura pasiva;
el servidor busca secciones de aprendizajes y listas con reglas de texto.
Esa captura concreta no es una lectura universal por IA de toda conversación.

Referencias verificadas:
- https://github.com/Gentleman-Programming/engram/blob/main/plugin/codex/skills/memory/SKILL.md
- https://github.com/Gentleman-Programming/engram/blob/main/plugin/claude-code/hooks/hooks.json
- https://github.com/Gentleman-Programming/engram/blob/main/plugin/claude-code/scripts/subagent-stop.sh
- https://github.com/Gentleman-Programming/engram/blob/main/internal/store/store.go
  Funciones ExtractLearnings y PassiveCapture.

Diferencia conceptual con Softmax: su ruta de ingestión envía el texto recibido
a un modelo extractor configurado en el servidor (Reflector) antes de procesar
candidatos de memoria. Gentleman puede recibir un recuerdo ya seleccionado y
redactado por el asistente. En ambos casos una integración entrega la información;
no basta instalar el programa para observar cualquier chat.

Nuestro objetivo sigue siendo combinar guardado proactivo del asistente con
extracción adicional configurable cuando aporte valor. No está implementado
todavía: no documentar MCP, hooks, modelo económico ni aprendizaje por feedback
como funciones disponibles. Esta corrección solo cambia la ubicación normal de datos
y aclara el diseño. El comando save manual permanece para pruebas y uso explícito.

## Validación y entrega

Lee src/paths.ts, src/store.ts, src/cli.ts y las pruebas de CLI/instalador.
Ejecuta bun test y bun run typecheck para obtener el estado vigente.
Se añadieron pruebas de dos directorios que comparten base sin mezclar proyectos,
y de SDK sin ruta que comparte memoria con CLI. Las pruebas del ejecutable usan
--db temporal para no tocar datos personales.

Actualiza instalación, recorrido, referencia CLI, SDK, arquitectura, solución
de errores y glosario de ambos idiomas. Comprobar búsqueda por «memory.sqlite»,
«directorio de ejecución», «working directory», «ruta obligatoria» y equivalentes;
dejar la ruta vieja solo en explicación histórica o migración pendiente.
Revisar enlaces de traducción y ejemplos. Entrega lista de cambios, evidencia y
enlaces de Notion solo si realmente se publicaron.
