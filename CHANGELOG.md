# Changelog

## 1.5.1 — pendiente de revisión

- `startup-context` ahora conserva el contexto `shared` y devuelve `project.status: "unbound"` para cualquier directorio existente y legible sin vínculo, incluidos el hogar, la raíz, carpetas sin Git y repositorios Git no vinculados.
- `FORGE614_HOME` permite elegir una raíz absoluta para toda la instalación de Engram; valores vacíos o relativos fallan de forma explícita con `INVALID_FORGE614_HOME` y no escriben bajo el hogar real.
