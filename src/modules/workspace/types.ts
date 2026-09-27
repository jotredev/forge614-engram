/** La configuración persistida de un espacio de trabajo (workspace): el motor de almacenamiento local (siempre SQLite por ahora), y, si la sincronización con la nube está activada, la URL de conexión a PostgreSQL y el identificador de esta instalación (máquina). */
export interface WorkspaceSettings {storage:"sqlite";postgresUrl?:string;installationId?:string}
