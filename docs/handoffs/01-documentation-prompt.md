# Prompt de documentación — etapa 1: memoria local

Copia desde «Tu tarea» hasta el final en la sesión del modelo que documentará.
Este archivo es un encargo para otro modelo; no sustituye las guías de usuario.

---

Tu tarea es documentar la primera etapa real de Forge614 Engram. No implementes
funciones ni cambies el código. El producto completo se construye paso a paso;
describe lo existente y etiqueta el resto como pendiente.

## Entregables e idiomas

Produce documentación completa y equivalente en dos carpetas separadas:
`docs/es/` en español y `docs/en/` en inglés. Usa los mismos nombres de archivo
para que cada página tenga su traducción claramente identificada. Crea un índice
raíz que permita elegir idioma. Publica el mismo contenido en una página de Notion
con dos ramas, Español y English, si tienes acceso y el usuario indica el destino.
Si falta conexión o destino, termina los documentos locales y señala exactamente
qué falta para publicar. No afirmes que Notion está actualizado sin comprobarlo.
No sobrescribas páginas ajenas; crea páginas específicas para este proyecto.

Escribe para una persona sin conocimientos de programación. Primero explica
qué hace cada cosa y por qué le sirve; luego pon el nombre técnico entre paréntesis.
Ejemplo: «impedir que dos reintentos guarden lo mismo dos veces (idempotencia)».
Los identificadores de código y los comandos se mantienen iguales en ambos idiomas.
Evita dar por conocidos base de datos, terminal, JSON, proyecto, versión o índice.
Incluye ejemplos concretos, resultados interpretados y pasos para solucionar errores.
No prometas perfección, exactitud semántica ni capacidades futuras como existentes.

## Fuente de verdad

Repositorio local: `/Users/jorgeetrejoo/Desktop/forge614-engram`.
Rama de trabajo: `feat/local-memory-foundation`.
Lee antes de escribir:
- `package.json`, `tsconfig.json`, `.gitignore`.
- `src/domain.ts`, `src/schema.ts`, `src/store.ts`, `src/index.ts`, `src/cli.ts`.
- `tests/store.test.ts`, `tests/cli.test.ts`.
- `docs/superpowers/specs/2026-09-16-local-memory-design.md`.
- `docs/superpowers/plans/2026-09-16-local-memory.md`.

El código y sus pruebas mandan sobre este resumen si detectas diferencias.
En ese caso documenta lo comprobado y reporta la diferencia sin modificar código.

## Qué existe en esta etapa

Implementación TypeScript estricta ejecutada con Bun. Bun mínimo declarado 1.3.8;
dependencias de desarrollo fijadas y archivo bun.lock. No hay dependencias de
ejecución externas: SQLite viene a través de bun:sqlite. No requiere claves ni
llamadas a IA. No envía recuerdos a servicios externos ni tiene telemetría.

Dos maneras de uso: terminal (CLI) e importación TypeScript local (SDK).
El paquete es privado y no está publicado. No inventes un comando de instalación
desde npm ni compatibilidad con Node.js: depende de Bun.

La CLI usa `.forge614/memory.sqlite` relativa al directorio desde el que se ejecuta.
Cada comando de datos admite `--db` para elegir un archivo. Para compartir recuerdos
entre directorios hay que usar explícitamente la misma ruta absoluta. La base se
crea automáticamente al abrirla, incluso en un comando de lectura válido.
La ayuda y los argumentos inválidos no crean base. El SDK exige una ruta explícita;
`:memory:` crea almacenamiento efímero que desaparece al cerrar.

Cada recuerdo tiene identificador, proyecto, título, texto, tipo, tema opcional,
prioridad, versión y fechas. Get añade estado actual: active o archived.
Tipos: fact, decision, procedure, warning, preference. CLI usa fact por defecto;
SDK requiere type. Proyectos se recortan y pasan a minúsculas. Temas se recortan
pero distinguen mayúsculas. No se detectan proyectos por Git o carpetas.

Todos los accesos requieren proyecto. Esto separa datos dentro de la aplicación;
no es autenticación ni control de usuarios. Cualquier persona con acceso al archivo
puede leerlo. No guardar contraseñas o información sensible en los ejemplos.

## Guardado e historial

Sin tema, cada save crea un recuerdo; texto repetido sin requestKey puede duplicarse.
Con un tema nuevo se crea versión 1. Un tema existente exige expectedVersion igual
a la versión vigente; el nuevo guardado conserva identificador y agrega revisión.
La actualización envía el contenido completo; no es una edición parcial.
Omitir pinned lo deja en false y omitir type en CLI lo deja en fact, incluso al
actualizar: explicar cómo conservar esos campos en la nueva petición.
El título y contenido se recortan por los extremos.

requestKey identifica una petición dentro del proyecto. Repetir los mismos datos
normalizados con la misma clave devuelve la versión original sin nueva escritura,
incluso si hay revisiones posteriores. Reutilizar la clave con datos distintos
es un error. Guardar deliberadamente una revisión nueva necesita una clave nueva
o ninguna. expectedVersion forma parte de esos datos normalizados.

history devuelve las versiones de contenido en orden ascendente, sin el estado
actual ni una lista de acciones de archivo. Las acciones sí quedan en una tabla
interna de eventos; todavía no existe comando para listarlas.

archive oculta el recuerdo de las búsquedas; get e history lo siguen mostrando.
restore lo devuelve a búsquedas. Ninguno borra versiones ni incrementa su número.
No modifican updatedAt del contenido. Repetir archivo/restauración sin cambio es
inofensivo. Un tema archivado debe restaurarse antes de actualizarlo.
No existe borrado permanente, exportación ni comando para listar todos los recuerdos.

## Búsqueda y fórmulas implementadas

Busca solo el proyecto indicado y recuerdos activos. Todas las palabras de la
consulta deben aparecer; pueden estar en campos distintos. Las consultas se tratan
como texto literal, no como expresiones SQL o instrucciones de búsqueda avanzada.
No hay filtros por tipo ni búsqueda semántica todavía.

FTS5 trigram busca fragmentos de tres caracteres o más. Los campos tienen pesos:
título 5, contenido 1, tema 3. BM25 es una puntuación textual: valores menores,
más negativos, indican mejor coincidencia. No es probabilidad ni veracidad.

La fórmula de orden existente es:
    r = 1 / (1 + max(0, días_desde_updatedAt) / 30)
    multiplicador = 1 + 0.10 * pinned + 0.06 * r
    orden = BM25 * multiplicador
Se ordena de menor a mayor, con identificador para desempates.
Ejemplo ilustrativo, no resultado fijo de una consulta: BM25=-2, prioridad activa
y 30 días de antigüedad dan r=0.5, multiplicador=1.13 y orden=-2.26.

Si cualquier término tiene menos de tres caracteres, se recorren los recuerdos
activos del proyecto mediante comparación literal en minúsculas Unicode. Esta
ruta existe para casos como «UI árbol». No calcula BM25: ordena por prioridad,
fecha de actualización descendente e identificador. Puede ser más lenta en
proyectos grandes. No elimina acentos ni promete búsqueda lingüística universal.
Límite predeterminado 10; permitido 1..100. No hay paginación todavía.

Cada resultado tiene memory y explanation, incluyendo mode (fts5 o literal),
bm25, multiplier y orderScore. En modo literal ambos scores son null y multiplier=1.
Los resultados contienen texto completo, no una vista abreviada. Explica su
impacto en datos grandes; aún no hay presupuesto de tokens.

## Comandos que debes documentar individualmente

Desde la raíz del proyecto:
    bun install
    bun run cli help
    bun run cli save --project demo --title "Base de datos" --content "Usamos SQLite localmente" --type decision --topic architecture/database --request-key demo-v1
    bun run cli search --project demo --query SQLite
    bun run cli save --project demo --title "Base de datos" --content "Usamos SQLite y conservamos revisiones" --type decision --topic architecture/database --expected-version 1 --request-key demo-v2

Para get, history, archive y restore, usa --project demo --id con el identificador
devuelto por save. Todos aceptan --db. Documenta --pinned true|false y --limit.
Explica qué debe sustituir la persona, dónde encuentra el identificador y qué
cambia en la base tras cada acción. No presentes marcadores de ejemplo como IDs reales.
En cada idioma traduce los textos de muestra, conservando banderas y tipos.

La CLI exige comando antes de opciones. Cada opción recibe un valor; no acepta
opciones duplicadas, desconocidas, --key=value ni valores que empiecen por --.
Usar comillas para textos con espacios. Salida normal: JSON por stdout.
Errores: JSON por stderr y salida 1. La ayuda y errores actuales están en español;
traducir su explicación en las guías inglesas, sin afirmar que hay selector de idioma.

## Uso programático que debes explicar

Importar desde `src/index.ts` dentro de este repositorio:
    import { MemoryStore } from "./src/index";
    const store = new MemoryStore("./.forge614/example.sqlite");
    try {
      const saved = store.save({project:"demo",title:"Database",content:"Use SQLite",type:"decision"});
      console.log(store.search("demo","SQLite"));
      console.log(store.get("demo",saved.id));
    } finally { store.close(); }

Explicar los métodos save, get, search, history, archive, restore y close.
Get desconocido devuelve null en SDK, pero error NOT_FOUND en CLI; history
desconocido devuelve []. El SDK lanza MemoryError para errores del dominio,
y puede propagar errores de SQLite/sistema. No prometer que todos son MemoryError.

## Integridad, fallos y datos personales

La base conserva versión actual, historial, eventos y claves de peticiones.
Los cambios se hacen juntos o se deshacen juntos (transacción). El índice textual
se actualiza automáticamente (triggers). Versiones obsoletas se rechazan para
evitar pisar una edición. Escritores se serializan y esperan hasta cinco segundos
si la base está ocupada; no hay cola de reintentos automática.
Se rechazan bases con tablas ajenas o una versión de esquema más nueva.

Errores que debe cubrir una tabla de ayuda: INVALID_INPUT, VERSION_CONFLICT,
REQUEST_CONFLICT, ARCHIVED, NOT_FOUND, DATABASE_VERSION, DATABASE_OWNER,
STORAGE_ERROR. Explicar acción recomendada sin pedir al usuario borrar la base.

El almacenamiento no está cifrado por la aplicación. SQLite puede generar
archivos auxiliares -wal y -shm. No recomendar copiar solo el archivo principal
mientras hay escritores activos. Todavía no existe exportación/restauración
de respaldo implementada; archive/restore solo cambia la visibilidad de recuerdos.

## Verificación y límites

Ejecuta `bun test` y `bun run typecheck` para reportar el estado vigente. La revisión
de esta entrega comprobó SQLite real, persistencia, aislamiento, reintentos,
revisiones, índice, rollback ante fallo y escritores concurrentes por procesos.
También se añadieron regresiones de identificadores con espacios y texto acentuado.
No extrapoles estos resultados a todas las plataformas o a millones de recuerdos.
El entorno de implementación fue macOS con Bun 1.3.8 y SQLite 3.51.0.

Pendiente: sesiones, MCP, HTTP, embeddings, RRF, MMR, recall con presupuesto,
feedback, relaciones de conocimiento, consolidación y exportación/importación.
En particular, esta etapa usa memoria versionada y búsqueda textual; todavía
no implementa la combinación semántica completa de Gentleman y Softmax.

Estructura sugerida por idioma: README.md (índice y estado), getting-started.md,
guide.md (recorrido), cli.md, sdk.md, internals.md, troubleshooting.md,
glossary.md y roadmap.md. Puedes añadir páginas para mejorar claridad sin
inventar funciones. Cada página debe indicar etapa, estado y traducción hermana.

Antes de entregar: verificar todos los ejemplos en una base temporal sin tocar
recuerdos personales; comprobar enlaces; comparar ambas versiones para asegurar
paridad; comprobar publicación de Notion si se hizo. Reporta archivos creados,
enlaces de Notion, pruebas ejecutadas y pendientes reales.
