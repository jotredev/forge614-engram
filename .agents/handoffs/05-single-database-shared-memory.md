# Prompt documental — una sola base y recuerdos compartidos

Este es el encargo vigente para el modelo de documentación. Sustituye las
indicaciones de configuración por proyecto del handoff 04 y cualquier instrucción
anterior incompatible. No hace falta documentar el diseño descartado como función.

---

Actualiza las guías de forge614-engram en español (`docs/es/`) e inglés
(`docs/en/`) y sus páginas de Notion. Cada idioma va separado. Escribe para una
persona sin experiencia y explica los tecnicismos entre paréntesis. No cambies
código, no ejecutes operaciones sobre datos reales y no publiques configuraciones
ni secretos del usuario. Comprueba fuentes, ejemplos y enlaces internos.

## Corrección fundamental

El usuario aclaró que TODOS los proyectos comparten UNA base de datos y UN .env.
No se admiten bases SQLite diferentes por proyecto ni conexiones PostgreSQL por
proyecto. PostgreSQL será una opción global futura, no está implementado aún.
El campo definitivo se llama exactamente `projectId`, no `idProject`.

```text
~/.forge614/
  .env
  engram.db
```

`~` es la carpeta personal del usuario. Este es el único espacio de memoria de la
CLI; no depende del directorio desde donde se ejecuta. No hay archivos .env por
proyecto, ni carpetas projects/<ID>, ni conexiones asignadas a cada proyecto.
SQLite puede crear archivos auxiliares engram.db-wal y engram.db-shm: son parte
del funcionamiento de la misma base, no otras bases por proyecto.

Configuración local actual, generada automáticamente:

```dotenv
FORMAT_VERSION="2"
STORAGE="sqlite"
```

La ruta SQLite es fija dentro de ese espacio: engram.db. El .env no tiene
projectId ni DATABASE_PATH ni credenciales en esta etapa. Cuando exista PostgreSQL,
su conexión será global en este mismo .env y sustituirá al almacenamiento local;
no afirmar que hoy admite DATABASE_URL o que ya hay sincronización.

El lector acepta esas dos claves con cadenas entre comillas dobles (escapes JSON),
líneas vacías y comentarios completos que comiencen con #. No evalúa shell ni
expande variables y no carga estas claves en process.env. No instruir a ejecutar
el archivo con source. No es un lector genérico de todas las variantes de dotenv.
Versiones de esta entrega: programa 0.2.0, formato de configuración 2, esquema
SQLite 3. Son versiones distintas para elementos distintos.

## Proyectos e identidad

Los proyectos están registrados en la tabla projects de esa única base.
Cada proyecto tiene projectId (UUIDv4 en minúsculas), name, createdAt y updatedAt.
Los nombres pueden repetirse o cambiar sin cambiar la identidad.
Los recuerdos del proyecto contienen su mismo projectId, referenciado en la base.
projectId no es una contraseña, ni una identidad de usuario, ni un mecanismo de
autorización. Todavía no hay usuarios/equipos/permisos multiusuario.
No se deduce el proyecto a partir de carpetas o remotos Git. No hay selección
automática de proyecto activo en esta etapa.

## Dos alcances para los recuerdos

Explicar scope como «alcance: dónde aplica este recuerdo»:

| scope | projectId | Uso |
| --- | --- | --- |
| project | UUID de un proyecto registrado | Decisiones/aprendizajes propios de ese proyecto |
| shared | null (sin proyecto) | Preferencias o aprendizajes que aplican a todos los proyectos |

Ejemplos: «Esta aplicación usa PostgreSQL» pertenece al proyecto. «Prefiero que
me expliques en español» puede ser compartido si esa intención es explícita.
shared NO es otro proyecto ni otra base. Un recuerdo compartido se guarda una
sola vez, no se copia en todos los proyectos.

Guardar es project por defecto y requiere projectId. Guardar shared exige
scope explícito y no admite projectId. Nunca se promueve automáticamente una
decisión de un proyecto a regla universal. SQLite impone la coherencia con
restricciones (CHECK) y referencias (claves foráneas).

Las reglas compartidas son conocimiento para orientar al asistente, no mensajes
de sistema ni autorización para ignorar permisos, restricciones o instrucciones.
El asistente aún no está conectado: guardar por memory_save continúa pendiente.

## Recuperación y excepciones

Buscar desde un proyecto incluye POR DEFECTO sus recuerdos relevantes y los
compartidos relevantes. Nunca devuelve los recuerdos privados de otro proyecto.
Se puede elegir solo project o solo shared. Todas las rutas excluyen archivados
y respetan el límite. Los resultados incluyen scope y projectId para reconocer
su procedencia. No se cargan todos los recuerdos universales en cada respuesta.

Para una excepción comprobable, usar el mismo topicKey (clave de tema):
- Un recuerdo shared con topicKey runtime dice «Bun como preferencia general».
- El proyecto A tiene un recuerdo activo con topicKey runtime que dice «Node.js
  por compatibilidad con este proyecto».
- En la búsqueda combinada de A, se omite el recuerdo shared de ese tema.
- El recuerdo shared se conserva; otros proyectos lo siguen viendo y se puede
  consultar directamente mediante búsqueda shared.
- Al archivar la excepción del proyecto A, la preferencia compartida vuelve a
  ser elegible. Restaurar la excepción vuelve a darle prioridad.

La comparación de topicKey es exacta y sensible a mayúsculas. Se aplica incluso
si el texto de la excepción NO coincide con la consulta; evita recuperar una
regla general que sabemos sustituida para ese tema. Sin un tema común no hay
resolución automática de contradicciones: pueden aparecer ambos recuerdos.
No presentar esto como comprensión semántica o entrenamiento del modelo.

El historial, control de versiones, reintentos y archivo/restauración funcionan
también para shared. Cada proyecto y el espacio shared tienen claves de tema y
petición independientes: usar el mismo texto de clave no mezcla sus registros.

## CLI actual: ejemplos comprobables

La instalación sigue siendo desde el repositorio, no npm. Si se reemplaza un
ejecutable instalado anteriormente, scripts/install.sh requiere --force para
reemplazar SOLO ese ejecutable, no datos ni configuración.

```bash
bash scripts/install.sh
forge614-engram --version
forge614-engram init
forge614-engram project-create --name "Mi aplicación"
forge614-engram project-list
```

init prepara la configuración y la base una vez. Es repetible sin reinicializar
datos. project-create también puede inicializar el espacio si aún no está
configurado. Crear un proyecto nuevo requiere una base vacía/dedicada para la
primera inicialización, o una base Forge614 ya compatible para añadirlo.
Si ya existe .env pero falta la base, falla: nunca crea una sustituta silenciosa.
Para guardar shared sin crear ningún proyecto, usar init primero.

project-create devuelve projectId, name, createdAt y updatedAt. En los ejemplos
siguientes, sustituir <projectId-real> por el UUID devuelto; no usar el nombre:

```bash
forge614-engram save --project-id <projectId-real> --title "Base elegida" --content "Usaremos SQLite" --type decision
forge614-engram search --project-id <projectId-real> --query "SQLite"
forge614-engram search --project-id <projectId-real> --scope project --query "SQLite"
forge614-engram project-rename --project-id <projectId-real> --name "Nuevo nombre"
```

Recuerdo compartido explícito:

```bash
forge614-engram save --scope shared --title "Idioma preferido" --content "Prefiero explicaciones en español" --type preference --topic preferences/language
forge614-engram search --scope shared --query "español"
forge614-engram search --project-id <projectId-real> --scope shared --query "español"
```

search con --project-id acepta --scope all|project|shared; all es su valor por
defecto. Sin project-id, search EXIGE --scope shared, no hay búsqueda universal
implícita de todos los proyectos. all significa «este proyecto + shared», no
«todos los proyectos de la base».

Para get, history, archive, restore:
- Recuerdo del proyecto: --project-id <projectId-real> --id <id-del-recuerdo>.
- Recuerdo compartido: --scope shared --id <id-del-recuerdo>.
- Estos comandos, igual que save, rechazan combinar --scope shared y --project-id.
- Encontrar un shared desde una búsqueda de proyecto NO permite editarlo o
  archivarlo pasando solo ese projectId: hay que indicar shared explícitamente.

save mantiene --topic, --expected-version, --request-key y --pinned. Actualizar
un tema existente exige su versión actual. Archivar conserva historial; no hay
borrado definitivo. Las salidas son JSON, errores a stderr con estado de salida 1.

Eliminar de guías vigentes: --id-project, --project por nombre, --db en comandos
de usuario, project-connect, configuración/credenciales por proyecto y selección
de una base individual para cada proyecto. No son funciones actuales.

project-list lista TODOS los proyectos de la única base; no depende de carpetas
de registro local. Antes de inicializar devuelve [] sin crear archivos; ante una
configuración existente inválida o una base inaccesible, informa error, no finge
que no hay proyectos. No imprime conexión ni ruta de la base.

## SDK TypeScript vigente

Ejemplo para un archivo en la raíz del repositorio. Ajustar importaciones si lo
sitúas en otra carpeta; no inventar un paquete npm publicado:

```typescript
import { MemoryWorkspace } from "./src/index";

const workspace = new MemoryWorkspace();
workspace.init();
const project = workspace.createProject("Mi aplicación");
const store = workspace.open();
try {
  store.save({
    projectId: project.projectId,
    title: "Base elegida",
    content: "Usaremos SQLite",
    type: "decision",
  });
  store.save({
    scope: "shared",
    projectId: null,
    title: "Idioma preferido",
    content: "Prefiero explicaciones en español",
    type: "preference",
    topicKey: "preferences/language",
  });
  console.log(store.search(project.projectId, "español"));
  console.log(store.search(null, "español", 10, "shared"));
} finally {
  store.close();
}
```

No llamar createProject en cada arranque: crea una identidad nueva. Reutilizar el
projectId existente, consultable mediante listProjects. API de MemoryWorkspace:
init, open(readonly?), createProject, listProjects, renameProject.
WorkspaceConfig es el lector/escritor global. Sus ubicaciones explícitas son
inyección para pruebas/uso programático avanzado, no conexiones por proyecto.
Las clases ProjectConfigs y ConfiguredProjects del diseño anterior ya no existen.

MemoryStore es la capa de bajo nivel. Permite una ruta explícita para pruebas y
uso programático, pero la aplicación no asigna almacenes individuales a proyectos.
Métodos de memoria: save, get, history, search, archive, restore, close.
get/history/archive/restore reciben projectId o null para shared. search recibe
(projectId, query, limit=10, scope='all'); null exige scope shared explícito.
save con null sin scope shared se rechaza. No es un mecanismo de autorización
multiusuario: un programa con acceso al almacén puede seleccionar esos alcances.

## Seguridad, conservación y límites

- .env privado, modo 600; carpeta del usuario de la aplicación, modo 700.
  Se comprueba propietario, enlaces simbólicos y formato. No se cambian permisos
  ajenos silenciosamente. Archivos ocultos no son archivos cifrados.
- Las bases nuevas se crean en modo 600. Antes de abrir SQLite, se rechazan
  enlaces simbólicos, enlaces duros, tipos especiales y propietarios ajenos en
  engram.db y sus archivos auxiliares. Los permisos de archivos ya existentes
  no se modifican silenciosamente. La carpeta privada es parte de la protección;
  no se promete protección frente a un administrador o software malicioso que
  se ejecute como el mismo usuario y manipule simultáneamente sus archivos.
- Publicación atómica sin reemplazo; una configuración compatible existente se
  conserva, incluso sus comentarios. No se evalúan comandos de su contenido.
- Un directorio antiguo projects/ se rechaza con LEGACY_CONFIG: no se importa,
  mueve ni elimina automáticamente. No aconsejar borrarlo sin revisar sus datos.
- Esquemas SQLite 1/2 se rechazan con MIGRATION_REQUIRED. El usuario confirmó no
  tener datos reales; no se implementó ni ejecutó migración. Nunca afirmar que
  convertir de idProject a projectId se hará automáticamente sobre datos reales.
- Una base ajena o alterada se rechaza sin reparar. La validación compara
  estructura, versión y propietario; no es auditoría integral de los datos.
- Si .env existe pero falta la base, no se crea ni se cambia a otra ubicación.
  El error es DATABASE_MISSING. Para enlaces/tipos/propietarios no permitidos,
  DATABASE_PATH_UNSAFE. Mantener también la documentación de CONFIG_NOT_FOUND,
  CONFIG_INVALID, PROJECT_NOT_FOUND, INVALID_INPUT y los errores de recuerdos.
- No hay transacción única entre archivos y SQLite. Si una inicialización deja
  la base creada pero falla publicar .env, conserva la base; repetir init valida
  la base compatible y vuelve a intentar la configuración, sin resetearla.
- No hay comandos para eliminar bases/proyectos, cambiar de conexión por
  proyecto o migrar automáticamente. No hay sincronización ni copia alternativa.
- No publicar .env, rutas privadas, contraseñas o recuerdos reales en Notion.
- FTS5/BM25 y búsqueda literal mantienen sus fórmulas. Se añade selección por
  alcance y prioridad por tema, no embeddings ni un agente en segundo plano.
- PostgreSQL, asistente de configuración, memory_save, mejoras matemáticas
  adicionales y TUI siguen pendientes en ese orden de etapas.

## Validación y entrega documental

Resultado final: 65 pruebas pasan, 0 fallos, 483 aserciones. TypeScript y
git diff --check sin errores. Tras corregir el hallazgo de revisión sobre enlaces
en la base, también pasaron 45 ejecuciones de pruebas de concurrencia (15 rondas).
Revisión independiente terminada sin hallazgos importantes pendientes.

Consultar el resultado final de pruebas de esta entrega. Se prueban SQLite real,
archivos temporales, procesos separados, inicialización concurrente, peticiones
repetidas project/shared, scopes, excepciones, archivo/historial y negativa a
alterar bases antiguas. Se compila y prueba el ejecutable sin Bun en PATH para
ayuda, versión y validación de argumentos; los flujos completos de memoria se
prueban con procesos Bun aislados. No afirmar pruebas en Linux o Windows: esta
entrega se verifica en macOS/Bun 1.3.8.

Actualizar instalación, recorrido, CLI, SDK, arquitectura, errores, glosario,
roadmap y README en ambos idiomas. Marcar los documentos anteriores como
históricos cuando corresponda. Entregar resumen de páginas modificadas y
separación clara entre lo implementado y lo pendiente. No tocar código.
