# 07. Glosario de Conceptos en Lenguaje Cotidiano

> **Etapa:** MCP Local, Menú TUI de Asistentes, Memoria Local y Sincronización PostgreSQL Opcional
> **Versiones de esta entrega:** Programa 0.5.0 | Formato de configuración 2 (local) / 3 (con sync) | Esquema SQLite 3 (local) / 4 (con sync) / 5 (asistentes y asociaciones locales)
> **Estado:** Vigente y Activo (Verificado con 191 pruebas en macOS con Bun 1.3.8)
> **Traducción hermana:** [07 (EN). Plain-Language Glossary](../en/07-glossary.md)

Este glosario explica cada concepto técnico utilizando analogías y lenguaje de la vida cotidiana, seguido de su término técnico formal entre paréntesis.

---

### Protocolo de Contexto de Modelo (Model Context Protocol / MCP)
Estándar abierto de comunicación que permite a los modelos de inteligencia artificial conectarse de forma segura y uniforme a herramientas y fuentes de datos externas. En Forge614 Engram opera localmente a través de la entrada y salida estándar de la computadora (`stdio`).

### Menú Interactivo en Terminal (Terminal User Interface / TUI / `tui`)
Panel visual interactivo a pantalla completa dentro de la consola de comandos donde una persona puede seleccionar opciones con las flechas del teclado y la barra espaciadora, previsualizar cambios, ejecutar autopruebas y confirmar configuraciones sin tener que editar manualmente archivos de configuración.

### Autoprueba del Servidor MCP (MCP Server Self-Test)
Prueba automatizada y asíncrona que el menú TUI ejecuta sobre el ejecutable binario de Engram instalado en tu máquina. Utiliza el SDK oficial de MCP para iniciar el servidor por canales estándar (`stdio`), verificar que responda con el nombre oficial `forge614-engram` y confirmar que exponga las 5 herramientas de memoria esperadas dentro de un plazo estricto de 5 segundos. **No prueba las sesiones reales de los clientes de IA**, las cuales deben verificarse dentro de cada editor.

### Vinculación o Asociación Local de Proyecto (Project Binding / `project_bindings`)
Registro en la base de datos local (tabla `project_bindings` de Esquema 5) que asocia una ruta física de carpeta en el disco duro de este equipo con un identificador de proyecto (`projectId`). Es exclusivo de cada computadora y jamás se sincroniza a través de la red hacia otras máquinas.

### Directorio Raíz Común de Git (Git Common Directory / `--git-common-dir`)
Ubicación física canónica del repositorio Git principal. Permite que múltiples subcarpetas y entornos de trabajo vinculados (*linked worktrees*) reconozcan automáticamente que pertenecen al mismo proyecto de software, accediendo a los mismos recuerdos sin duplicar identidades.

### Entorno de Trabajo Vinculado (Linked Worktree)
Característica avanzada de Git (`git worktree add`) que permite tener varias ramas de un mismo repositorio abiertas simultáneamente en carpetas separadas de tu disco. Gracias a la resolución canónica de Engram, todos los worktrees de un repositorio comparten exactamente la misma memoria.

### Validación Previa de Seguridad (Preflight Check)
Inspección rigurosa y previa a la escritura que realiza el menú TUI antes de modificar cualquier archivo de configuración. Comprueba permisos, rechaza enlaces simbólicos (*symlinks*) que puedan apuntar a ubicaciones inseguras y valida que los archivos no superen tamaños máximos permitidos.

### Copia de Respaldo Privada con Sufijo UUID (UUID-Suffixed Private Backup)
Archivo de respaldo generado automáticamente antes de aplicar cambios a la configuración de un cliente (por ejemplo, `~/.claude.json.3a8f...bak`). Se crea con permisos estrictos de acceso exclusivo (`0600`) y contiene los bytes anteriores exactos para garantizar recuperación ante cualquier imprevisto.

### Publicado sin Verificar (Published Unverified / `PUBLISHED_UNVERIFIED`)
Advertencia de seguridad que se emite cuando Engram aplicó con éxito la configuración en el archivo de un cliente, pero al volverlo a leer inmediatamente para verificar su integridad, los bytes no coincidieron con lo esperado debido a que otro proceso o el propio editor modificó el archivo de forma concurrente. En este caso, Engram conserva la copia de respaldo y no realiza una marcha atrás destructiva.

### Gancho o Adaptador Nativo de Asistente (Native Hook / `memory-hook`)
Adaptador de software invocado por los clientes de desarrollo al dispararse eventos del ciclo de vida (como el inicio de una sesión o el envío de un prompt). Engram utiliza este gancho para inyectar recordatorios de contexto que orientan al modelo a consultar la memoria antes de investigar, sin escribir datos directamente en la base.

### Intención Global Explícita (`globalIntent`)
Justificación en texto obligatorio que el asistente debe proporcionar cuando desea guardar un recuerdo con alcance compartido (`scope: "shared"`). Explica formalmente por qué esa decisión o preferencia aplica de manera universal a todos los proyectos de la computadora, previniendo que notas contextuales se filtren accidentalmente al espacio compartido.

### Detección vs Configuración vs Sesión Probada
Tres estados honestos e independientes que el sistema distingue con claridad:
1. **Detectado:** El ejecutable del cliente está instalado en el sistema operativo.
2. **Configurado:** Los archivos de configuración del cliente contienen los comandos de Engram.
3. **Sesión Probada:** La sesión interactiva real del asistente fue iniciada y se comprobó que el modelo invoca las herramientas MCP.

### Política de Confianza de Ganchos en Codex (`/hooks` Trust Policy)
Mecanismo de seguridad nativo de Codex mediante el cual cualquier gancho de automatización recién instalado debe ser revisado y aprobado explícitamente por el usuario a través del comando `/hooks` dentro de Codex antes de que se le permita ejecutarse.

### Terminal interactiva con soporte de teclado (Interactive TTY / `isTTY`)
Canal de consola interactivo donde una persona puede interactuar directamente por teclado. Si no está presente, `setup` y `tui` fallan con `INTERACTIVE_REQUIRED`.

### Código de salida por cancelación del usuario (Exit Code 130)
Código devuelto al sistema operativo cuando una operación interactiva (`setup`, `tui`, `sync-watch` o `mcp`) es cancelada o interrumpida voluntariamente con `Ctrl+C`, `Escape` o `q`.

### Espacio central de usuario (`~/.forge614/`)
Directorio personal donde residen la configuración y la base de datos de memoria, protegido con permisos de acceso exclusivo para tu usuario (`0700`).

### Base de datos central única (`engram.db`)
El archivo de base de datos SQLite donde se guardan todos los proyectos, recuerdos, revisiones, peticiones y asociaciones locales en una única estructura relacional.

### Identificador único de proyecto (`projectId`)
Código UUIDv4 inmutable asignado a cada proyecto registrado, garantizando que cambiar el nombre visible jamás altere su identidad ni pierda el acceso a sus recuerdos.

### Alcance de una nota (`scope`)
Propiedad que define si una nota aplica exclusivamente a un proyecto (`project`) o si es universal para todos los proyectos (`shared`).

### Sustitución o excepción por tema (Topic override)
Regla lógica por la cual una nota activa de un proyecto sustituye a una nota compartida con el mismo tema (`topicKey`) en las búsquedas combinadas del proyecto.

### Algoritmo BM25
Fórmula matemática (*Best Matching 25*) que evalúa la relevancia de un texto en búsquedas según la frecuencia y rareza de las palabras coincidentes.

### Réplica PostgreSQL opcional (PostgreSQL Replica / Direct sync)
Copia de respaldo que vive en un servidor PostgreSQL configurado por ti para sincronizar el espacio de trabajo entre múltiples computadoras sin servidores intermedios en la nube.

### Fusión de tres vías (3-Way Snapshot Merge)
Algoritmo determinista que compara la fotografía base del último acuerdo común, el estado local y el estado remoto para combinar cambios pacíficamente.
