# Prompt documental — identidad y configuración por proyecto

> SUPERSEDIDO: no utilizar este diseño de conexiones por proyecto. El usuario
> corrigió el requisito a UNA base y UN .env, con projectId y scope project/shared.
> Usar `05-single-database-shared-memory.md` como fuente vigente.

Copia el siguiente encargo al modelo que mantiene la documentación. Este handoff
reemplaza las instrucciones de identidad, comandos y SDK de los handoffs 01–03.
No reemplaza sus explicaciones correctas sobre búsqueda, historial o instalación.

---

Actualiza la documentación de forge614-engram en `docs/es/` y `docs/en/`, manteniendo
idiomas en carpetas separadas, y las páginas correspondientes de Notion. Escribe
para personas sin experiencia técnica y explica los términos entre paréntesis.
No modifiques código ni ejecutes comandos que creen recuerdos reales. No copies
archivos `.env`, conexiones privadas ni información del usuario en la documentación.

## Estado de esta entrega

La etapa 1 del nuevo orden de trabajo está implementada: identidad permanente
`idProject` y configuración privada por proyecto. Versión del programa: 0.2.0.
Es una versión previa a publicación con cambios de interfaz respecto de 0.1.0.

El usuario confirmó que no ha guardado recuerdos reales. Por tanto, NO se ha
implementado ni ejecutado una migración. El programa rechaza las bases de formato
anterior sin modificarlas. No aconsejes borrarlas: podrían contener información.
Si alguien tiene datos antiguos, debe conservarlos y esperar una migración
explícita; puede elegir otra base vacía para proyectos nuevos.

No confundir versión del programa 0.2.0, versión de base SQLite 2 y versión del
formato de configuración 1: sirven para comprobar compatibilidad de cosas distintas.

## Identidad y nombres

- Cada proyecto nuevo recibe un UUID versión 4 en minúsculas, denominado
  `idProject`. Es una identidad generada aleatoriamente, no una contraseña.
- La tabla `projects`, los recuerdos, las peticiones repetibles y el archivo de
  configuración utilizan el mismo `idProject`.
- El nombre visible es independiente y puede cambiar. No es una clave única:
  dos proyectos llamados igual tienen identidades y recuerdos distintos.
- Renombrar conserva identidad, recuerdos, historial, estado de archivo y
  comportamiento de reintentos. Se eliminan espacios exteriores del nombre,
  pero se conservan sus mayúsculas y minúsculas.
- Conectar un proyecto existente reutiliza su UUID. No se calcula a partir de
  la carpeta ni del remoto Git; tampoco se detecta automáticamente el proyecto.
- Una base puede contener varios proyectos. Tener su UUID no equivale a tener
  permisos: todavía no existe administración de usuarios o equipos.

## Ubicación y privacidad

Configuración predeterminada:

```text
~/.forge614/
  engram.db
  projects/
    <idProject>/
      .env
```

`~` representa la carpeta personal del usuario. Cambiar de directorio de trabajo
no cambia la identidad ni la configuración. La CLI no guarda el `.env` en el
repositorio del proyecto. Cada proyecto puede apuntar a una base SQLite diferente,
o varios pueden compartir `~/.forge614/engram.db`, separados por UUID.

Ejemplo FICTICIO de configuración generada por el programa:

```dotenv
FORMAT_VERSION="1"
ID_PROJECT="11111111-1111-4111-8111-111111111111"
STORAGE="sqlite"
DATABASE_PATH="/Users/example/.forge614/engram.db"
```

Explicar que `ID_PROJECT` es la clave del archivo y contiene exactamente el
`idProject` de la base; no son dos identificadores distintos. El ejemplo no crea
un proyecto y su UUID no debe copiarse como identidad de un proyecto real.

El lector de configuración admite estas cuatro claves con cadenas entre comillas
dobles, usando escapes JSON; líneas vacías y comentarios completos con `#`.
No es un intérprete de shell ni admite todas las variantes de dotenv. No expande
`$VARIABLE`, no ejecuta comandos y no carga los valores en `process.env`.
El archivo lo genera la aplicación: no instruyas al usuario a ejecutarlo con
`source`, ni a editarlo manualmente para cambiar de base.

Carpetas privadas: modo 700. Archivo `.env`: modo 600, propietario actual.
Se rechazan permisos abiertos, enlaces simbólicos en las rutas administradas,
identidades que no coinciden y archivos inválidos. No se cambian silenciosamente
los permisos de archivos existentes. Una configuración diferente no sobrescribe
una existente; reconectar con la misma configuración sí es repetible.

Los permisos no son cifrado ni protegen frente a programas maliciosos ejecutados
como el mismo usuario o un administrador. La base contiene texto sin cifrar.
El SDK avanzado permite proporcionar una ubicación explícita a ProjectConfigs;
la CLI utiliza siempre la ubicación predeterminada en la carpeta del usuario.

## Recorrido de CLI que sí existe

La instalación sigue siendo desde el repositorio, no npm:

```bash
bash scripts/install.sh
forge614-engram --version
forge614-engram project-create --name "Mi aplicación"
forge614-engram project-list
```

Si ya se instaló un ejecutable anterior, el instalador exige `--force` para
reemplazar SOLO ese ejecutable. No reinicializa ni modifica las bases:

```bash
bash scripts/install.sh --force
```

`project-create` devuelve JSON con `idProject`, `name`, `createdAt`, `updatedAt`.
El usuario copia el ID devuelto, no el nombre, en los comandos siguientes.
En estos ejemplos `<idProject-real>` es un marcador que debe reemplazarse:

```bash
forge614-engram save --id-project <idProject-real> --title "Base elegida" --content "Usaremos SQLite localmente" --type decision
forge614-engram search --id-project <idProject-real> --query "SQLite"
forge614-engram project-rename --id-project <idProject-real> --name "Nuevo nombre"
```

También requieren `--id-project`: `get`, `history`, `archive`, `restore`.
Conservan `--id` para identificar el recuerdo, no el proyecto.
`save` conserva --topic, --expected-version, --request-key y --pinned.

Crear un proyecto en otro archivo SQLite (ruta absoluta):

```bash
forge614-engram project-create --name "Otro proyecto" --db /ruta/absoluta/otra-base.sqlite
```

Registrar localmente un proyecto que YA existe en una base accesible:

```bash
forge614-engram project-connect --id-project <idProject-existente> --db /ruta/absoluta/base-existente.sqlite
```

Este comando comprueba la base y el proyecto antes de escribir configuración.
No genera un UUID nuevo, no crea un archivo de base inexistente y no inicializa
una base vacía. Repetirlo no borra ni duplica recuerdos. El ejemplo es local:
no implica sincronización entre máquinas ni acceso remoto a SQLite.

`project-list` lista proyectos CONFIGURADOS EN ESTA INSTALACIÓN, no descubre
todos los proyectos de cualquier base. Devuelve idProject, name, storage y
status. `available` indica que pudo abrir y validar el proyecto; `unavailable`
indica un fallo de configuración, acceso, identidad o compatibilidad. En ese
caso name y storage son null. No revela rutas ni valores de conexión.

Cambios incompatibles que hay que corregir en TODAS las guías vigentes:
- `--project demo` ya no existe: se rechaza, no se traduce silenciosamente.
- `--db` solo corresponde a project-create y project-connect. Los comandos de
  recuerdos resuelven la base desde la configuración del proyecto.
- Primero se crea o conecta el proyecto. `save` no lo crea implícitamente.
- No hay proyecto activo implícito, selector interactivo ni TUI todavía.
- `save` sigue siendo una operación manual o programática. El guardado por el
  asistente a través de `memory_save` todavía no está conectado.

## SDK TypeScript

Ejemplo para un archivo situado en la raíz del repositorio (explica la ruta de
importación si sitúas el ejemplo en otra carpeta):

```typescript
import { ConfiguredProjects } from "./src/index";

const projects = new ConfiguredProjects();
const project = projects.create("Mi aplicación");
const store = projects.open(project.idProject);
try {
  const memory = store.save({
    idProject: project.idProject,
    title: "Base elegida",
    content: "Usaremos SQLite localmente",
    type: "decision",
  });
  console.log(store.get(project.idProject, memory.id));
} finally {
  store.close();
}
```

Advertir que `create` es intencionalmente una creación nueva en cada llamada;
no repetirla en cada arranque. Conservar/reutilizar el ID y usar `open` o
`connect` según corresponda. Métodos de ConfiguredProjects: create, connect,
list, rename, open. `open(idProject, true)` solicita lectura solamente.
El MemoryStore devuelto es de bajo nivel y sigue requiriendo idProject en sus
operaciones; no es un control de acceso ni un objeto restringido a un solo usuario.

`MemoryStore` también expone createProject, getProject, listProjects y
renameProject, sin registrar automáticamente configuración local. Sus entradas
y resultados de memoria usan `idProject`, no `project`. El constructor acepta
opciones create/readonly; el servicio configurado abre bases existentes sin
recrearlas si faltan. La mayoría de usuarios no necesita instanciar estas clases.

## Conservación de datos y errores

- Solo se inicializa una base vacía y dedicada mediante creación explícita.
  Una base compatible se reutiliza: no se recrean tablas ni se reparan esquemas.
- La validación compara la estructura esperada completa de SQLite (tablas,
  índices, restricciones y disparadores), además de propietario y versión.
  Alteraciones manuales, incluso objetos extra, se rechazan. Esta comprobación
  no equivale a una auditoría de integridad del contenido ni a una copia de seguridad.
- Bases ajenas, antiguas o incompatibles se rechazan sin migrar ni resetear.
- Si falta la base configurada, se informa el fallo; no se crea una memoria
  vacía de reemplazo ni se cambia silenciosamente a otra ubicación.
- No hay comandos para borrar bases o proyectos. Archivar recuerdos sigue
  siendo reversible y mantiene su historial.
- SQLite puede mantener archivos auxiliares -wal y -shm. No prometer ausencia
  absoluta de actividad de archivos durante una lectura ni recomendar copiar
  solo el archivo principal mientras hay escritores activos.
- Si se crea el proyecto en la base pero falla guardar su configuración local,
  PROJECT_REGISTRATION_FAILED devuelve su UUID para recuperarlo mediante
  project-connect. No se borra el proyecto como compensación y no debe repetirse
  project-create. Las operaciones de base y archivos no son una sola transacción.
- Errores relevantes: INVALID_INPUT, CONFIG_NOT_FOUND, CONFIG_INVALID,
  CONFIG_CONFLICT, PROJECT_NOT_FOUND, PROJECT_REGISTRATION_FAILED,
  MIGRATION_REQUIRED, DATABASE_SCHEMA, DATABASE_VERSION, DATABASE_OWNER,
  DATABASE_UNINITIALIZED; conservar también los errores de recuerdos.
- Los errores de la CLI no imprimen valores privados. No solicites al usuario
  que comparta el `.env` para diagnosticar un problema.

## Validación y límites

Las pruebas usan SQLite real, directorios temporales y procesos separados.
Verifican aislamiento, renombrado, historial/reintentos, permisos, conexiones
distintas por proyecto, reconexión repetida, escrituras simultáneas y rechazo de
bases antiguas/ajenas/modificadas sin reparación. También compilan el instalador
y prueban el ejecutable sin Bun disponible en PATH. Consultar el informe de esta
entrega para cifras finales; comandos: bun test, bun run typecheck, git diff --check.
Resultado verificado de esta entrega: 54 pruebas pasan, 0 fallos, 314 aserciones;
TypeScript y comprobación de espacios del diff sin errores. Revisión independiente
completada y hallazgos corregidos.

Probado en macOS con Bun 1.3.8. No afirmar pruebas en Linux o Windows.
No se cambian las fórmulas de búsqueda, no se añaden embeddings ni llamadas a IA.
No afirmar seguridad multiusuario, sincronización o entrenamiento de modelos.

Orden siguiente, manteniendo las etapas separadas:
1. Identidad/configuración por proyecto: implementada; migración antigua diferida.
2. Asistente interactivo de configuración: pendiente.
3. PostgreSQL compatible (Neon, Supabase u otro proveedor): pendiente.
4. Guardado desde el asistente mediante memory_save: pendiente.
5. Mejoras de recuperación y puntuación: pendientes.
6. TUI de administración dentro de la terminal: pendiente.

Revisa README, instalación, recorrido, CLI, SDK, arquitectura, errores, glosario
y roadmap en ambos idiomas. Mantén las traducciones equivalentes y sus enlaces
válidos. Conserva los documentos de diseño históricos como históricos, no como
guías de comandos actuales. Entrega resumen de páginas modificadas y distingue
lo implementado de lo pendiente. No cambies código ni publiques secretos.
