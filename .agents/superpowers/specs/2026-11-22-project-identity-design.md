# Identidad de proyecto al reclonar, trasladar o empezar de cero

Diseño para [Forge614 Engram #26](https://github.com/jotredev/forge614-engram/issues/26). La corrección de carpetas ya vinculadas cubre el caso de [#24](https://github.com/jotredev/forge614-engram/issues/24).

## Qué debe poder hacer cualquier usuario

| Situación | Resultado |
| --- | --- |
| Reclonar el mismo repositorio en otra carpeta | Engram reconoce el remoto confirmado y recupera el UUID, los recuerdos, el historial y el ecosistema. |
| Mover la carpeta o trasladar el repositorio a otro remoto | Mover la carpeta con el mismo remoto conserva la identidad. Si cambia el remoto, el usuario puede confirmarlo para que los siguientes clones recuperen el mismo UUID. |
| Empezar un proyecto independiente, incluso copiando archivos o historial de Git | El proyecto recibe un UUID propio y empieza sin recuerdos de proyecto. Si se crea explícitamente, su ecosistema se elige por separado. |
| Corregir una carpeta que quedó vinculada al UUID equivocado | Engram corrige el vínculo de esa carpeta. Cada UUID conserva sus recuerdos, sesiones e historial. |

Las mismas reglas se aplican a todos los repositorios. Se compararon dos opciones para una carpeta nueva con remoto conocido. Pedir confirmación siempre evita dar por hecho que la carpeta es otro checkout, pero añade un paso a cada reclon. La propuesta es recuperar automáticamente una coincidencia confirmada y única, pedir decisión ante evidencia contradictoria y ofrecer una acción explícita para empezar desde cero.

Si se copia un repositorio y se deja intacto su `origin` y su archivo legado, para Engram sigue pareciendo otro checkout del mismo proyecto. Si la intención es empezar un proyecto independiente, se configura su propio remoto o se ejecuta la creación explícita antes de abrir una sesión de Engram. Engram conserva el vínculo explícito aunque el remoto heredado siga en la configuración.

## Cómo se resuelve una carpeta

Usar la clave del directorio común de Git. Los worktrees enlazados comparten proyecto y conservan sus propias raíces de sesión. Mantener las validaciones existentes para Git roto, carpetas sin Git y rutas que no pueden vincularse.

| Evidencia disponible | Lectura y primer arranque | Inicio de sesión o guardado |
| --- | --- | --- |
| Vínculo local sin contradicciones | Usa el proyecto vinculado | Usa el mismo UUID |
| Vínculo explícito que registró qué evidencia local se desplazó | Usa el proyecto elegido si la evidencia sigue dentro de lo aceptado | Usa el mismo UUID |
| Carpeta nueva con remoto confirmado, candidato único y archivo ausente o compatible | Lee contexto de proyecto y ecosistema sin escribir | Registra el vínculo y usa el UUID en la misma transacción |
| Varios candidatos, asociación histórica sin confirmar, archivo incompatible o remoto que apunta a otro UUID | Comparte contexto general y avisa que se debe resolver la identidad | Rechaza con `PROJECT_BINDING_REQUIRED` antes de escribir |
| Catálogo de nube pendiente y carpeta nueva con remoto usable o archivo legado | Comparte contexto general y avisa que falta sincronizar | Pide sincronizar o declarar una intención explícita |
| Archivo legado válido como única evidencia, sin contradicciones | Conserva la recuperación por archivo | Usa el UUID declarado |
| Sin candidato ni archivo | Devuelve estado sin vínculo | Conserva las comprobaciones por nombre y ruta perdida antes de registrar un UUID nuevo |

Un archivo legado inválido sigue dando `PROJECT_FILE_INVALID` y conserva sus bytes. Un vínculo previo sigue funcionando si cambia a un remoto libre y el archivo es compatible. Engram avisa que hace falta confirmar la nueva dirección para los futuros clones. Un remoto que corresponde a otro UUID exige resolver el conflicto.

El arranque JSON conserva `format: 1`, `bound`/`unbound` y `source: "path"` para coincidencias por remoto. Los avisos se entregan en `project.notices`. El formato 2 reserva espacio dentro de su límite para una línea breve cuando hace falta actuar. MCP conserva la memoria compartida cuando hay conflicto y excluye los ámbitos de proyecto y ecosistema. La coincidencia por remoto sobre una base actualizada funciona en solo lectura.

## Operaciones explícitas

Extender los comandos existentes. Los nombres de opciones son parte de la propuesta técnica.

| Comando | Efecto |
| --- | --- |
| `project-create --name <nombre>` | Conserva el comportamiento actual. Crea la identidad sin vincular una carpeta. |
| `project-create --name <nombre> --directory <carpeta> [--replace-from <UUID>]` | Crea y vincula un proyecto vacío en la misma transacción. Si la carpeta ya está vinculada, exige indicar el UUID anterior. |
| `project-bind --directory <carpeta> --project-id <UUID> [--replace-from <UUID>] [--accept-origin]` | Elige un proyecto existente. Puede corregir una vinculación con el UUID anterior esperado o confirmar el remoto actual para futuros reclones. |

La creación explícita elige un UUID nuevo aunque exista un candidato por remoto. Si la carpeta trae una identidad legada válida, la respuesta informa qué declaración se desplazó. Si había un vínculo, se compara `--replace-from` con su UUID dentro de la transacción. En `project-bind`, esa opción también permite resolver un conflicto con un archivo legado cuando la carpeta aún no tiene vínculo, usando el UUID que declara el archivo. `project-bind` sin opciones adicionales conserva el error ante una vinculación o declaración incompatible.

La creación explícita abre un proyecto con cero recuerdos y sesiones de proyecto. La política de grupo de ese UUID exige membresía explícita, incluso si la carpeta contiene una declaración de nodo copiada. `group-bind` y `group-unbind` administran esa membresía. La política se conserva en otros equipos. En el registro ordinario y con archivos legados compatibles, las declaraciones de grupo existentes siguen su flujo actual. La memoria personal compartida está disponible según su alcance habitual.

Al crear desde una carpeta realmente nueva con remoto libre y catálogo al día, registrar el remoto. Si ya había un vínculo, hay identidad legada desplazada, el catálogo está incompleto o el remoto trae candidatos, crear sin adjudicarlo. Para la carpeta corregida, guardar el remoto observado y los UUID de la evidencia desplazada. La excepción es local a la clave de directorio común y aplica a esos datos. Un tercer candidato o un archivo con otro UUID exige resolver el nuevo conflicto.

`--accept-origin` requiere un remoto usable, catálogo disponible y ausencia de candidatos de otro UUID. Confirmar un traslado conserva el UUID, sustituye la dirección para nuevas coincidencias y conserva los checkouts ya vinculados. Un proyecto que todavía comparte el remoto de otro puede funcionar a partir de su vínculo de carpeta. Cuando tenga su propio remoto, se confirma su uso para futuros clones.

Cada corrección registra los UUID anterior y nuevo y su causa. Una repetición exacta devuelve el mismo resultado mientras siga vigente el vínculo resultante. Una corrección posterior obliga a reevaluar los valores esperados. Las sesiones anteriores conservan su dueño. Un intento de reutilizar su ID desde otro proyecto falla. Una sesión nueva guarda en el UUID correcto.

## Persistencia, actualización y sincronización

- El vínculo de carpeta queda en SQLite local. La copia de compatibilidad `project_remotes` conserva sus tres campos y se habilita también en las bases locales. Las claves de remoto confirmadas y la política de grupo viven en el catálogo SQLite. Los ajustes se guardan por separado para que confirmar un traslado y modificar la política de grupo no se sobrescriban mutuamente.
- La normalización iguala HTTPS y SSH con puertos predeterminados, preserva puertos no estándar y el caso de la ruta, y excluye secretos, rutas locales y remotos sin identidad inequívoca. Una fila histórica de 1.10.0 es solo una pista porque esa versión descartaba todos los puertos. Completar la asociación confirmada si las carpetas Git vinculadas y accesibles de un UUID aportan una sola clave concordante. La base conserva datos históricos ante dudas. Las escrituras de 1.10.0 a la copia de compatibilidad no sobrescriben un remoto confirmado por el cliente actualizado.
- La migración conserva las funciones de cada nivel SQLite, los UUID, las membresías, el historial y el estado de nube. Hace respaldo previo, usa una transacción inmediata, valida el esquema dentro del bloqueo y se puede reintentar. Las conexiones de solo lectura nunca ejecutan DDL. Una versión que desconoce el esquema actualizado devuelve un error de versión.
- Replicar los ajustes mediante la nube incremental. Un cliente antiguo puede saltar el tipo nuevo y avanzar su cursor. Tras actualizarlo, recuperar solo esos ajustes con un cursor propio, sin rebobinar ni repetir cambios de recuerdos. El vínculo de carpeta, rutas locales, eventos de corrección y URL cruda permanecen locales. Mantener los formatos históricos de snapshot 1–3. El traslado sin nube usa un respaldo de SQLite.
- Si hay nube configurada, la resolución de carpetas nuevas con remoto o archivo legado espera a que termine la primera descarga de la réplica y el cursor de identidad alcance al general. Una carpeta ya vinculada sigue operando. Una acción explícita puede trabajar con los UUID conocidos y dejar pendiente la confirmación del remoto. Con nube apagada se usa el catálogo local. En otra máquina, Engram recupera la identidad una vez sincronizados o restaurados los datos. Una base vacía no puede reconstruir recuerdos desde Git.
- Probar la convivencia entre dos clientes y actualizar los binarios que abran la misma base, incluidos los que compilan la biblioteca de Engram, antes de habilitar el esquema nuevo en esa instalación.

## Archivos legados y Git

Con un remoto usable, la ruta ordinaria se apoya en SQLite. Si una ruta Git aún crea `.forge614/project.json`, incluida la creación indirecta por cambio de grupo, primero verificar la regla `/.forge614/` en el `.gitignore` raíz. Preservar contenido y finales de línea, evitar reglas duplicadas y comprobar la exclusión con Git. Si la exclusión falla, emitir un aviso y mantener utilizable SQLite. Conservar el comportamiento de carpetas sin Git.

Un archivo rastreado se lee y se informa. El operador conserva el control del índice y de sus bytes. La corrección explícita registra el UUID legado desplazado para la clave de directorio común. Un worktree hermano con ese mismo archivo sigue usando el proyecto elegido. Otro UUID incompatible deja pendiente esa raíz. Las publicaciones de archivos se hacen después del commit de SQLite.

## Pruebas de aceptación

- Con nube apagada, un reclon sin `.forge614/` ve en el primer arranque el mismo UUID, recuerdo y ecosistema. La lectura conserva los bytes de la base y del árbol.
- Un repositorio nuevo con su propio remoto libre recibe un UUID vacío. Una copia con el remoto, el archivo de identidad y el nodo de otro proyecto también puede empezar desde cero mediante la creación explícita. Una segunda operación usa el nuevo UUID, la membresía queda vacía y el proyecto anterior permanece íntegro.
- Un checkout con evidencia ambigua conserva disponible el contexto compartido. Las lecturas de proyecto y grupo quedan vacías y los guardados y sesiones no crean datos.
- HTTPS y SSH equivalentes conservan la identidad. Dos puertos no estándar distintos o dos forks no se confunden. Un traslado confirmado conserva el UUID y permite reconocer los futuros clones de la dirección nueva.
- Corregir el vínculo sobrevive al reinicio, a un archivo legado copiado, a sesiones abiertas y al guardado concurrente. Los reintentos y los fallos anteriores al commit conservan la consistencia.
- Una instalación sincronizada recupera el UUID, el recuerdo, el grupo y sus reglas. La migración desde 1.10.0 conserva los cursores y la cola pendiente. La segunda apertura no migra ni duplica cambios.
- Si se genera el archivo legado, quedan cubiertas las reglas Git negadas, permisos, symlinks, archivos rastreados y escrituras concurrentes.

Los recuerdos que ya se grabaron bajo un UUID equivocado requieren revisión de contenido. El cambio de vínculo conserva su dueño histórico.
