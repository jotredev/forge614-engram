# Plan de implementación de identidad de proyecto

> Ejecutar por tareas con `superpowers:executing-plans` o `superpowers:subagent-driven-development`. Las casillas registran avances.

**Objetivo.** Reclonar o trasladar un proyecto conservando su identidad, iniciar proyectos vacíos y corregir vínculos de carpeta.

**Arquitectura.** SQLite mantiene el catálogo de remotos y los vínculos locales. CLI, MCP y SDK consumen la misma decisión de identidad. Los archivos legados aportan evidencia y cualquier publicación opcional ocurre después del commit.

**Tecnología.** Bun, TypeScript, SQLite, el lector local de configuración Git y la réplica PostgreSQL existente.

**Diseño.** [Identidad de proyecto al reclonar, trasladar o empezar de cero](../specs/2026-11-22-project-identity-design.md).

## Restricciones

- Ejecutar las pruebas con `FORGE614_HOME` temporal y Git fixtures locales. Conservar las funciones habilitadas en las bases existentes y los formatos de arranque 1 y 2.
- Mantener junto a la escritura normal los checks de identidad, la creación del vínculo y el inicio de sesión o guardado. Un fallo revierte el conjunto de cambios de SQLite.
- Mantener fuera de la réplica los vínculos de carpeta, las rutas y los eventos de corrección locales. Los payloads de `project_remotes` conservan sus tres campos.
- Mantener una base de trabajo aislada para implementar. Los cambios de código, binario, base real y publicación quedan para la fase de implementación.

## Casos que requieren revisión

| Caso | Prueba |
| --- | --- |
| Un cliente anterior avanzó el cursor al omitir ajustes de identidad. | La tarea 5 recupera los ajustes omitidos y conserva el cursor general. |
| Una carpeta de proyecto nuevo conserva el archivo y el remoto de otro proyecto tras una corrección. | Las tareas 2 y 3 verifican que la primera lectura, el primer guardado y el reinicio usan el UUID nuevo. |
| La migración ve dos remotos distintos para un mismo UUID o queda interrumpida. | La tarea 1 verifica que el caso ambiguo sigue pendiente, hay respaldo y la migración se puede repetir. |
| Un grupo cambió y la actualización indirecta intenta crear identidad en un worktree rastreado o con exclusión inefectiva. | La tarea 4 cubre esta vía con Git real y comprueba los bytes del archivo. |
| Un arranque de solo lectura ve un remoto conocido y hay una sesión previa en otro proyecto. | Las tareas 2 y 3 verifican cero escrituras al resolver y rechazan asociar la sesión al UUID equivocado. |

### Tarea 1. Catálogo SQLite y migración

**Archivos.** `src/infrastructure/sqlite/schema.ts`, `src/infrastructure/sqlite/projects.ts`, `src/app/memory-store.ts`, `src/app/workspace.ts`, `src/modules/projects/remote.ts`, `src/infrastructure/git/remote-origin.ts`. Crear `src/infrastructure/sqlite/project-catalog.ts` y `src/infrastructure/sqlite/project-catalog.test.ts`.

**Contratos.** `normalizeIdentityOrigin(raw: string): string | null` recibe el valor crudo y devuelve una clave utilizable. `findProjectsByOrigin(db: Database, origin: string): Array<{ project: Project; verified: boolean }>` devuelve todos los candidatos ordenados por UUID. `ensureProjectIdentitySchema(db: Database): { migrated: boolean; backup: string | null }` conserva el conjunto de funciones activas.

- [ ] Agregar pruebas con bases de esquema 5, 8, 11 y 12. Verificar que cada nivel actualizado mantiene sus funciones, UUID, membresías, cursores y outbox. Agregar una apertura después de fallo simulado y otra apertura sin cambios. Agregar bases 3 y 4 para probar que activar vínculos mantiene su contrato.
- [ ] Ejecutar `bun test src/infrastructure/sqlite/project-catalog.test.ts src/modules/projects/remote.test.ts` y verificar que el catálogo local y las claves nuevas faltan en la línea base.
- [ ] Extender el esquema de vínculos con niveles equivalentes para 5–12 y reconocer ambos conjuntos por su DDL canónico. Reutilizar el respaldo y la transacción inmediata de las migraciones existentes. Al abrir de solo lectura un esquema anterior, conservar el comportamiento de lectura legado hasta actualizarlo. Integrar la activación en la ruta de escritura con vínculo, sin activar nube, ecosistema o sesiones por efecto colateral.
- [ ] Mantener `project_remotes` con su llave por proyecto para lecturas de compatibilidad. Crear `project_identity_settings` con llave `(project_id, setting)`, columnas `value` y `updated_at`, ajustes `origin` y `group_policy`, e índice por valor donde `setting='origin'`. Crear el registro local de correcciones por clave de directorio común. Las escrituras de remoto se hacen al registrar un proyecto con remoto libre, al completar una asociación histórica segura o al confirmar explícitamente.
- [ ] Normalizar HTTPS, SSH y forma SCP contra la misma clave para sus puertos habituales. Preservar puertos personalizados y el caso de la ruta. Rechazar rutas locales, secretos detectables, claves sin host y configuraciones con varias URL candidatas. Afirmar que ninguna prueba deja credenciales en la base, outbox ni salida.
- [ ] Completar remotos confirmados a partir de vínculos Git accesibles con un solo candidato concordante por UUID. Una fila histórica sola es una pista. Probar el mismo host con SSH en puerto no estándar, la carpeta ausente, un cliente viejo que anota luego otro valor para el mismo UUID y la primera activación de nube con catálogo local existente.
- [ ] Ejecutar `bun test src/infrastructure/sqlite/project-catalog.test.ts src/infrastructure/sqlite/{schema,projects,cloud-schema}.test.ts src/modules/projects/remote.test.ts src/infrastructure/git/remote-origin.test.ts` y `bun run typecheck`. Los suites pasan con los números del esquema y los fixtures actualizados de forma explícita.

### Tarea 2. Una resolución para arranque, lecturas, guardado y sesión

**Archivos.** `src/app/project-context.ts`, `src/app/project-identity.ts`, `src/app/memory-store.ts`, `src/app/startup-context.ts`, `src/modules/search/startup.ts`, `src/infrastructure/sqlite/projects.ts`, `src/infrastructure/sqlite/writes.ts`, `src/interfaces/mcp/{memory-tools,sessions-tools}.ts`. Pruebas en `src/app/__tests__/{project-context,project-identity}.integration.test.ts`, `src/app/startup-context.test.ts` y `src/interfaces/cli/__tests__/startup-context.e2e.test.ts`.

**Contratos.** El resolutor de decisiones devuelve `{ status: "known"; projectId: string; source: "binding" | "file" | "remote" }`, `{ status: "unbound" }` o `{ status: "pending"; reason: "ambiguous" | "conflict" | "unverified-origin" | "cloud-pending"; candidates: string[] }`. Usar la decisión dentro de las transacciones existentes de guardado y sesión. Los resultados públicos exponen el aviso con `code: "PROJECT_BINDING_REQUIRED"` y conservan las formas de arranque existentes.

- [ ] Crear dos checkouts temporales con el mismo remoto canónico y sin archivo de identidad. Guardar un recuerdo y asociar un grupo en el primero. Comprobar que el segundo ve el mismo UUID, grupo y recuerdo mediante `startup-context` y MCP, y que el primer guardado crea un vínculo, no otro proyecto.
- [ ] Probar un repositorio nuevo con remoto propio, una copia cuyo archivo legado contradice al remoto y una carpeta que tiene varios candidatos. El repositorio nuevo recibe un UUID vacío. Para los casos ambiguos, arranque, `memory_search` y `memory_context` conservan compartido y omiten proyecto y ecosistema. Verificar que `memory_save` y `memory_session_start` fallan sin registrar nada. Repetir con contradicción entre archivo y vínculo.
- [ ] Ejecutar `bun test src/app/__tests__/{project-context,project-identity}.integration.test.ts src/interfaces/cli/__tests__/startup-context.e2e.test.ts` y verificar que falla el reclon local y que el flujo actual acepta un archivo legado contradictorio.
- [ ] Compartir precedencia entre entradas. Leer el remoto una vez por operación cuando haga falta, sin añadir llamadas Git a la ruta estable. Validar y decidir antes de aplicar el archivo o inscribir grupos. Volver a comprobar vínculo, candidato y política dentro de `BEGIN IMMEDIATE` antes de escribir.
- [ ] Mantener estados, límites de salida y campos que leen Engines y Shell. En formato 1 informar con `project.notices`; en formato 2 contar el aviso dentro de los 5000 caracteres. Con un conflicto, el contexto compartido sigue disponible. Mantener `PROJECT_FILE_INVALID` para archivos corruptos y los códigos de un proyecto realmente sin vincular.
- [ ] Probar rollback si falla un guardado, dos procesos guardando inicialmente sobre el mismo clon, un bare repository y worktrees enlazados. Confirmar que una lectura de una base actualizada abierta de solo lectura preserva sus archivos y no registra un vínculo. Ejecutar las pruebas del paso anterior y las de MCP.

### Tarea 3. Comandos explícitos y corrección persistente

**Archivos.** `src/interfaces/cli/{arguments,commands,help}.ts`, `src/app/{index,project-context,project-identity,memory-store}.ts`, `src/infrastructure/sqlite/{writes,project-catalog}.ts`. Crear `src/interfaces/cli/__tests__/project-identity.e2e.test.ts`.

**Contratos.** `createProjectContext(store, directory, { name, replaceFrom? }): ProjectContext` y `bindProjectContext(store, directory, projectId, { replaceFrom?, acceptOrigin? } = {}): ProjectContext`. `project-create` con `--directory` usa la operación compuesta. La variante que solo recibe el nombre conserva su salida actual. `project-bind` agrega `--replace-from` para corregir una asociación anterior y `--accept-origin` para confirmar una dirección de Git.

- [ ] Agregar una prueba genérica con un proyecto A y una copia B que conserva remoto, archivo legado y nodo. Ejecutar `project-create --name B --directory <carpeta>` antes de una sesión. Verificar un UUID nuevo, cero recuerdos y cero sesiones de proyecto, ausencia de membresía heredada y primer guardado en B. Repetir cuando la carpeta estaba vinculada a A, con `--replace-from <UUID de A>`. En ambos casos A conserva su UUID, remoto, ecosistema y recuerdos.
- [ ] Agregar pruebas de un traslado con `project-bind --accept-origin` y de un remoto ya asignado. Confirmar que el traslado mantiene el UUID y reconoce futuros clones de la dirección nueva. El intento rechazado conserva ambos catálogos. Probar una corrección con UUID esperado incorrecto, un fallo antes del commit y la repetición del comando después de éxito.
- [ ] Ejecutar `bun test src/interfaces/cli/__tests__/project-identity.e2e.test.ts` y confirmar que falta la operación explícita.
- [ ] Implementar las opciones de creación y vinculación sin prompts. Registrar la decisión local junto con el vínculo y comparar el UUID anterior dentro de la transacción. Adjudicar el remoto al crear solo si está libre, el catálogo está listo y no hay vínculo ni archivo desplazado. Usar `--accept-origin` para una confirmación posterior. Registrar `group_policy=explicit` para que las operaciones de grupo controlen la membresía de ese UUID.
- [ ] Al corregir, registrar el UUID legado desplazado para ese directorio común, el remoto y los UUID candidatos que se aceptaron. Un tercer candidato o un archivo que declare otro UUID vuelve a dejar pendiente la raíz afectada. Probar worktrees hermanos, repetir un comando con su vínculo aún vigente y repetirlo después de una corrección posterior.
- [ ] Verificar un guardado concurrente y una sesión abierta que pertenecía al proyecto previo. Tras la corrección, un ID de sesión viejo es rechazado. Un ID nuevo y un guardado sin ID usan el UUID correcto. Ejecutar la prueba E2E y las suites de contexto de proyecto.

### Tarea 4. Protección de `.forge614/` en todas las escrituras

**Archivos.** `src/infrastructure/filesystem/project-identity-file.ts`, `src/app/project-identity.ts`, `src/infrastructure/git/project-directory.ts`. Crear `src/infrastructure/git/project-ignore.ts` y `src/infrastructure/git/project-ignore.test.ts`.

**Contrato.** `ensureProjectIgnored(root: string): "ignored" | "tracked" | "unavailable"` verifica el índice Git y la exclusión efectiva de `.forge614/project.json` con la raíz y configuración saneadas que utiliza el resolutor.

- [ ] Crear fixtures con Git real para un `.gitignore` inexistente, CRLF, regla existente, negación posterior, symlink, permisos insuficientes, archivo rastreado e intentos simultáneos. Añadir el caso de creación indirecta desde `group-bind` y worktrees con diferentes raíces.
- [ ] Ejecutar `bun test src/infrastructure/git/project-ignore.test.ts src/infrastructure/filesystem/project-identity-file.test.ts` y comprobar que falta la protección previa.
- [ ] Implementar una sola puerta de escritura para creación directa e indirecta. Añadir la regla al final si hace falta. Escribir sin perder bytes ni cambios detectados, con temporales en la misma carpeta y exclusión entre escritores de Engram. Verificar después con `git check-ignore --no-index` que la regla introducida protege el archivo y comprobar lo rastreado con una consulta separada al índice. Si Git falla, la identidad SQLite queda utilizable y se emite un aviso. Mantener lectura del archivo rastreado.
- [ ] Verificar que los repos con remoto usable ya no crean archivos de identidad con la ruta ordinaria, que las carpetas sin Git conservan su comportamiento y que ninguna publicación de archivos precede al commit de SQLite. Ejecutar las dos suites del paso anterior y las pruebas de ecosistema e identidad.

### Tarea 5. Replicación y actualización desde 1.10.0

**Archivos.** `src/infrastructure/sqlite/schema.ts`, `src/infrastructure/postgres/replica.ts`, `src/app/{cloud-apply,cloud-sync,cloud-control,cloud-background}.ts`. Ampliar pruebas en `src/app/{cloud-apply,cloud-sync}.test.ts`, `src/app/__tests__/cloud-sync.integration.test.ts` y `tests/e2e/postgres-sync.test.ts`.

**Contratos.** `project_identity_settings` replica `{ project_id, setting, value, updated_at }`. Añadir `pullProjectIdentitySettings(since: number, through: number, limit?: number, signal?: AbortSignal): Promise<ChangeRow[]>`. El cursor de identidad y la indicación de primera descarga completa se guardan por configuración de réplica. Una carpeta nueva con remoto usable o archivo legado requiere que el primer ciclo de descarga termine y que el cursor de identidad alcance al general.

- [ ] Simular un cliente 1.10.0 que descarga ajustes desconocidos y avanza el cursor común. Al actualizarlo, comprobar que recupera el remoto confirmado y la política de grupo. Abrir en la otra instalación una copia ya registrada como proyecto nuevo cuyo archivo de nodo sigue declarando el grupo anterior y verificar que conserva la membresía elegida. Agregar casos de réplica cambiada, lotes cortados y reintentos.
- [ ] Ejecutar `bun test src/app/{cloud-apply,cloud-sync}.test.ts src/app/__tests__/cloud-sync.integration.test.ts` y comprobar que falta recuperar los ajustes omitidos.
- [ ] Mantener el payload histórico del remoto. Encolar los ajustes por su clave primaria y validar su tipo y secretos antes de aplicarlos. Tras descargar los proyectos, recuperar ajustes filtrados hasta el cursor general y actualizar el cursor de identidad en la transacción de cada página. Un cursor ya alineado puede aplicar los nuevos ajustes con el flujo normal y actualizar ambos cursores juntos.
- [ ] Probar con dos instalaciones y un PostgreSQL efímero. En la segunda, confirmar que se recuperan UUID, recuerdo, grupo y ajustes antes de resolver el remoto. Cortar entre ambas descargas y comprobar que el arranque informa la espera dentro de su límite actual, que no se crea otro proyecto y que un vínculo previo sigue funcionando. Cubrir también `cloud off` y credenciales ausentes. Verificar que no se reprocesan recuerdos y que los compañeros antiguos sincronizan tipos conocidos.
- [ ] Ejecutar las pruebas de nube con la fixture PostgreSQL configurada. Una omisión de esa fixture queda como verificación pendiente para publicación.

### Tarea 6. Manuales, verificación y preparación de entrega

**Archivos.** `CHANGELOG.md`, manuales de CLI, resolución de errores y contexto de inicio en `docs/es/` y `docs/en/`. Revisar la compatibilidad de lectores en Forge614 Engines y Shell y la dependencia compilada en Atlas.

- [ ] Documentar los recorridos de reclon, traslado, creación desde cero y corrección. Mostrar cómo declarar el proyecto nuevo antes de abrir una sesión si una copia conserva el remoto anterior. Explicar la recuperación en otra máquina mediante respaldo o la nube incremental, y cómo sacar del índice un archivo legado conservando su copia local. Mostrar cómo abrir una sesión nueva tras corregir la carpeta y cómo revisar por separado recuerdos que ya quedaron en otro proyecto.
- [ ] Verificar el contrato con fixtures de salida actuales de Engines y Shell. Revisar qué artefactos de Atlas abren el mismo SQLite con una versión compilada anterior y fijar el orden compatible de actualización. Probar primero con backups y bases temporales. Comprobar que el binario anterior rechaza el esquema nuevo y que el respaldo se abre con el binario que lo creó.
- [ ] Ejecutar `bun run verify`, E2E de PostgreSQL y la matriz existente de binarios y smoke tests en macOS, Linux y Windows. Verificar tanto el reclon ordinario como la creación explícita de una copia independiente con nube apagada y activa.
- [ ] Preparar la revisión de cambios y los resultados para el propietario. Cerrar la implementación solo cuando los casos de aceptación estén reflejados en pruebas o en una verificación documentada.
