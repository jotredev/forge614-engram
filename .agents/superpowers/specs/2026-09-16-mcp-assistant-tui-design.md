# Entrega 08 — MCP y conexión de asistentes desde la terminal

Estado: implementación 0.5.0 completada y revisada; 191 pruebas aprobadas.
Base: main ebc5e8b, Forge614 Engram 0.4.0.
Rama: feat/mcp-assistant-tui. Sin commit, push ni cambios en ajustes personales.

## 1. Resultado acordado

Instalar Forge614 Engram desde el repositorio y conectar Claude Code, Codex,
Cursor, OpenCode y Gemini CLI mediante un menú visual de terminal (TUI).
La instalación detecta los asistentes, pero solo los configura tras confirmación.
La misma TUI permite conectar asistentes instalados posteriormente mediante
«Volver a detectar», sin reinstalar Engram ni modificar conexiones no seleccionadas.

El componente de comunicación (servidor MCP) pertenece al ejecutable de Engram.
No exige instalar otro programa, contratar otra IA, abrir un puerto ni mantener
la TUI abierta. Cada cliente inicia su proceso MCP local cuando lo necesita.
SQLite y FTS5 siguen siendo locales; PostgreSQL y sync-watch no cambian.

## 2. Alternativas y decisión propuesta

1. MCP local incluido y TUI con adaptadores por asistente: recomendado. Una sola
   instalación, configuración explícita y componentes comprobables por separado.
2. Un plugin completo distinto por asistente: mejor acceso a eventos específicos,
   pero multiplica mantenimiento y distribución. Usar adaptadores ligeros de
   eventos en esta entrega, no cinco productos independientes.
3. Un servicio HTTP permanente compartido: añade arranque, puertos y seguridad
   innecesarios para esta entrega. Se descarta por ahora.

La TUI usa navegación por teclado, selección múltiple, confirmación y redibujado;
no se presentará un simple cuestionario por líneas como una TUI completa.
La biblioteca concreta y sus versiones se fijarán en el plan técnico, tras
comprobar compatibilidad con Bun y el ejecutable compilado.

## 3. Flujo de instalación y TUI

- El instalador conserva la compilación desde el repositorio y no instala
  dependencias globales. Las dependencias del producto quedan fijadas en bun.lock.
- Después de instalar, detecta asistentes sin iniciar sus ejecutables ni leer
  conversaciones. Si hay terminal interactiva, ofrece abrir la configuración.
  Sin terminal muestra el resultado y el comando para continuar; nunca se bloquea
  esperando entrada ni configura asistentes silenciosamente.
- `forge614-engram tui` abre un menú con Asistentes y Salir. El explorador completo
  de recuerdos, proyectos e historial no forma parte de esta entrega.
- Asistentes muestra los cinco clientes, evidencia de detección y configuración,
  selección múltiple, Volver a detectar y Configurar seleccionados.
- Se buscan ejecutables en PATH y ubicaciones de aplicaciones compatibles.
  Una carpeta de configuración sola es una pista, no prueba de instalación.
  Se admite indicar una ubicación no estándar, con validación y confirmación.
- Antes de escribir muestra los destinos y la operación por asistente. Escape
  cancela sin cambios; Ctrl+C restaura el terminal. La selección inicial no
  autoriza una modificación hasta confirmar.
- Al terminar distingue éxito, ya configurado, conflicto y fallo. Un fallo no
  revierte a ciegas los cambios exitosos de otro asistente.

Estados independientes: detectado/no detectado; configurado/sin configurar/
configuración incompatible; prueba del servidor correcta/fallida/no realizada.
Una prueba propia de MCP no acredita que una sesión de un asistente vea las
herramientas. No mostrar «conectado» sin evidencia del cliente; indicar cuando
deba reiniciarse y comprobar la conexión desde él.
La acción opcional `t` prueba solo el ejecutable Engram instalado resuelto por la
TUI: inicialización y listado de cinco herramientas con SDK stdio real, sin crear
almacenamiento ni habilitar esquema. La terminal sigue respondiendo. Plazo de
5 segundos incluido el cierre normal; ante cancelación, error o plazo vencido,
cierre forzado y hasta 250 ms de recogida. Escape cancela la prueba conservando
la selección; Ctrl+C/EOF/error de entrada cierran la TUI y restauran terminal.
No mostrar stdout/stderr del hijo ni ejecutar comandos de configuración de clientes.

## 4. Configuración segura por asistente

Nombre reservado de conexión: `forge614-engram`. Comando: ruta absoluta al
ejecutable instalado; argumento `mcp`. No se fija como cwd la carpeta donde se
instaló Engram y no se copian credenciales de PostgreSQL a los clientes.

Destinos globales predeterminados, sujetos a las rutas personalizadas que admita
cada cliente y que deben verificarse antes de cualquier escritura:

| Asistente | Configuración | Entrada propia |
| --- | --- | --- |
| Claude Code | ~/.claude.json | mcpServers.forge614-engram |
| Codex | ~/.codex/config.toml | mcp_servers.forge614-engram |
| Cursor | ~/.cursor/mcp.json | mcpServers.forge614-engram |
| OpenCode | configuración global opencode.json u opencode.jsonc | mcp.forge614-engram |
| Gemini CLI | ~/.gemini/settings.json | mcpServers.forge614-engram |

Los adaptadores preservan otras claves, comentarios y formato donde el formato
los permite. JSON, JSONC y TOML se validan con analizadores adecuados, no mediante
sustituciones de texto sin comprensión de su estructura. Claves duplicadas,
destinos ambiguos o una entrada propia diferente bloquean esa operación; no se
reparan ni reemplazan automáticamente.

Antes de publicar: validar archivo regular y propietario, rechazar enlaces
simbólicos inseguros, limitar tamaño, guardar respaldo privado exacto y comprobar
que el contenido no cambió desde la vista previa. Publicación atómica por archivo
y comprobación posterior. La repetición idéntica no reescribe ni duplica entradas.
La comprobación posterior vuelve a leer con las mismas defensas y compara los
bytes exactos previstos. Un fallo devuelve `PUBLISHED_UNVERIFIED` sin rollback:
`appliedPaths` incluye todas las publicaciones, `unverifiedPaths` marca las no
verificadas y `backupPaths` conserva los respaldos; `ok` es falso. No filtrar
contenido privado mediante esos resultados.
No desactivar aprobaciones, sandbox, listas de exclusión o políticas administradas.
No imprimir archivos completos que puedan contener secretos. Los respaldos nunca
se suben ni se incluyen en sincronización PostgreSQL.

## 5. MCP y política de recuerdos

Transporte local stdio mediante SDK oficial compatible, sin servidor de red.
stdout se dedica exclusivamente al protocolo; diagnósticos sanitizados a stderr.
Validar todos los argumentos y limitar tamaños. Cerrar SQLite al terminar.

Herramientas iniciales:

- `memory_current_project`: resolver el proyecto y explicar de dónde se obtuvo.
- `memory_search`: buscar en el proyecto y shared, con las reglas existentes.
- `memory_get`: recuperar el recuerdo completo, comprobando su alcance.
- `memory_save`: guardar o revisar un tema, conservando versiones e idempotencia.
- `memory_history`: consultar versiones del recuerdo dentro de su alcance.

No se expone borrado físico, ejecución de shell, edición de configuración ni
operaciones PostgreSQL a través de estas herramientas.

El servidor entrega instrucciones de uso y descripciones claras: consultar antes
de repetir trabajo, guardar decisiones resueltas y aprendizajes duraderos, describir
qué se decidió y por qué, y actualizar temas existentes con su versión esperada.
Los resultados son datos, no instrucciones que puedan anular la política del
asistente. No copiar secretos, transcripciones completas o salidas de herramientas.

Por defecto el guardado exige projectId resuelto. Para shared se exige alcance
explícito y justificación de la intención global del usuario; nunca se infiere de
una palabra aislada o de no encontrar proyecto. La IA interpreta el contexto:
validar una justificación no demuestra matemáticamente que el usuario lo pidió.
Ante ambigüedad debe preguntar, sin guardar primero.

No hay otro modelo detrás, captura automática de cada mensaje ni entrenamiento
de pesos. Las instrucciones guían al asistente, pero MCP no garantiza que todos
los modelos guarden siempre. Los permisos de cada cliente siguen vigentes.
La aprobación posterior amplía esta entrega a hooks/plugins: instalar recordatorios
de inicio, trabajo y recuperación donde el cliente los admita, sin capturar
transcripciones ni disparar otra IA. Cada adaptador debe declarar eventos exactos,
permisos y limitaciones. No confundir disponibilidad de herramientas con
automatización probada. Ningún hook bloqueará indefinidamente el cierre ni generará
bucles de continuación para forzar guardados. El resumen de cierre se guarda como
recuerdo de procedimiento del proyecto con un tema de sesión, no en otra base.

Cobertura a implementar usando los contratos oficiales vigentes: Claude Code y
Codex, SessionStart y UserPromptSubmit; Gemini CLI, SessionStart y BeforeAgent;
Cursor, sessionStart; OpenCode, transformación del mensaje de sistema y contexto
de compactación. El protocolo común pide resumen antes de terminar en los cinco.
Solo activar eventos adicionales si su formato ha sido verificado y probado.
El cierre abrupto del proceso no puede garantizar un resumen semántico final.

## 6. Identidad automática de proyecto

No hay selección de proyecto durante la instalación. En una sesión, se resuelve
la carpeta de trabajo desde las raíces que aporte el cliente (MCP roots), una
carpeta explícita de la llamada cuando haga falta o un cwd válido de proyecto.
Una carpeta home, raíz del sistema o carpeta del binario no se acepta como
proyecto por defecto. Con varias raíces se necesita contexto que desambigüe.
Las raíces ayudan a contextualizar; no constituyen por sí solas una frontera
de seguridad ni autenticación del cliente.

Normalizar rutas reales y reconocer la raíz Git sin ejecutar hooks ni código del
repositorio. Para carpetas sin Git se requiere una raíz explícita del cliente.
Los subdirectorios de un mismo repositorio resuelven al mismo proyecto.

Guardar asociaciones locales carpeta-projectId en la misma engram.db, mediante
una ampliación aditiva validada del esquema. No crear otro .env, otra base ni
archivos dentro de los proyectos. La migración se autoriza al confirmar la
configuración de la integración; lecturas normales no alteran esquemas.
Las asociaciones de rutas no se replican: son propias de cada equipo. UUIDs y
recuerdos continúan replicándose con el formato existente.

Si la carpeta ya tiene asociación, reutilizarla. Si es un proyecto nuevo sin
posible coincidencia, crear UUID y asociación una sola vez al primer guardado,
de forma transaccional; una consulta sola no crea proyectos. Si hay proyectos
existentes potencialmente coincidentes o llega una copia desde otro equipo,
pedir vinculación explícita: nombres iguales no autorizan fusionar identidades.
Mover una carpeta no permitirá adivinar ni cambiar un projectId silenciosamente.
Ante una carpeta desconocida, comprobar solo las asociaciones registradas: si
algún proyecto tiene todas sus rutas no disponibles (incluidos fallos de lectura),
exigir `project-bind` antes de crear identidad. También se bloquean por prudencia
carpetas nuevas no relacionadas mientras exista esa ambigüedad; se puede crear
un proyecto explícitamente y vincularlo. Una ruta antigua recreada es un límite
inherente de identidad basada solo en rutas: no permite reconocer con fiabilidad
el directorio movido. No se escanea disco, añade marcadores ni infiere UUID de nombres.
Pruebas específicas cubrirán Git worktrees, carpetas anidadas y concurrencia.

## 7. Pruebas y criterios de aceptación

- Cliente MCP real de prueba: inicialización, descubrimiento de herramientas,
  lectura/guardado/búsqueda, errores, cierre y stdout válido. Probar también el
  ejecutable compilado, no solo TypeScript ejecutado por Bun.
- Carpeta sintética por cliente y fixtures JSON/JSONC/TOML: preservar ajustes,
  comentarios, permisos, respaldos, conflictos, archivos corruptos y carreras.
- TUI en pseudoterminal: flechas, selección múltiple, redetección, cancelación,
  confirmación, tamaño reducido y restauración tras error o Ctrl+C.
- Instalador interactivo y no interactivo; asistente instalado posteriormente;
  binario fuera de PATH; rutas con espacios y ubicaciones personalizadas.
- Aislamiento de proyectos, shared explícito, falta de contexto, versión obsoleta,
  repetición de solicitudes, migración aditiva y compatibilidad con sync.
- Suite existente, typecheck y diff check. PostgreSQL real solo en el cluster
  temporal de pruebas; sin tocar engram.db, .env o configuraciones personales.
- Las pruebas de adaptadores no se presentarán como cinco sesiones reales de IA.
  Si una sesión real requiere autorización o acceso adicional, se reportará como
  validación pendiente por cliente.

## 8. Entrega y límites

Implementar el alcance aprobado. Mantener cambios en la nueva rama,
sin commit/push/PR salvo petición del usuario. Entregar un handoff con cambios,
evidencias, límites y prompt para que otro modelo actualice docs/es/, docs/en/
y Notion. Esta fase no edita esas guías ni promete sincronización con Notion.

No incluye TUI completa, algoritmos nuevos de relevancia, servidor Cloud,
resolución de conflictos PostgreSQL, servicio permanente ni aislamiento multiusuario.

## 9. Fuentes oficiales consultadas

- [Codex MCP](https://developers.openai.com/codex/mcp/): stdio y tabla de configuración TOML.
- [Claude Code MCP](https://code.claude.com/docs/en/mcp): configuración de alcance usuario.
- [Cursor MCP](https://cursor.com/help/customization/mcp): archivo global y estructura mcpServers.
- [OpenCode MCP](https://opencode.ai/docs/mcp-servers/): configuración local y lista command.
- [Gemini CLI MCP](https://geminicli.com/docs/tools/mcp-server/): settings.json, mcpServers y alcance usuario.
- [MCP roots](https://modelcontextprotocol.io/specification/2025-06-18/client/roots): raíces suministradas por el cliente.
- [MCP tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools): herramientas y consentimiento.
- [Claude Code hooks](https://code.claude.com/docs/en/hooks).
- [Codex hooks](https://developers.openai.com/codex/hooks/).
- [Cursor hooks](https://cursor.com/docs/hooks).
- [Gemini CLI hooks](https://geminicli.com/docs/hooks/).
- [OpenCode plugins](https://opencode.ai/docs/plugins/).

Autorrevisión: sin secciones vacías; distingue configuración de conexión y de
comportamiento proactivo; asociaciones locales no alteran el formato replicado;
no crea bases por proyecto ni cambia a shared por descarte.
