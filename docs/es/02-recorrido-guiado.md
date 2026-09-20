# 02. Recorrido Guiado

1. Instala Engram y abre una terminal nueva.
2. Ejecuta `forge614-engram init` para inicialización guiada de memoria local, o `init --json` para automatización.
3. Crea un proyecto con `project-create --name <nombre>` y conserva el `projectId` devuelto.
4. Guarda conocimiento durable con `save --project-id <UUID> --title <título> --content <texto>`. Agrega `--topic <clave>` para un tema reemplazable.
5. Busca conocimiento de proyecto y compartido con `search --project-id <UUID> --query <palabras>`. Usa `--scope shared` para resultados solo compartidos.
6. Usa `get`, `history`, `archive`, `restore` y `context` para recuperar y administrar conocimiento de forma segura.
7. Habilita sesiones explícitamente con `sessions-enable`; después usa `session-start`, `session-summary` y `session-end` para trabajo reanudable.
8. Habilita el orden por recuerdos repetidos solo si lo deseas con `reinforcement-enable`.
9. Configura PostgreSQL solo si necesitas una réplica sincronizada; SQLite/FTS5 locales siguen siendo la primera ruta de lectura/escritura.
10. Inicia `forge614-engram mcp` cuando un cliente de IA ya configurado requiera herramientas de memoria. Engram no elige ni configura ese cliente.
11. Ejecuta `forge614-engram update` para instalar el binario estable más reciente sin cambiar recuerdos.

Todos los proyectos comparten una sola base SQLite, pero cada recuerdo siempre pertenece a su `projectId` o al alcance compartido explícito.
