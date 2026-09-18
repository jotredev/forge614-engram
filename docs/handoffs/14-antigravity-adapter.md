# Antigravity Adapter & Windows Path Guard: Discontinuation of Gemini CLI

Fecha: 2026-09-18. Rama: `feat/cross-platform-setup`.  
Estado: Implementado en código y pruebas; validación nativa de Windows en CI configurada y marcada formalmente como **pendiente de CI hasta confirmación del runner nativo**.

---

## 1. Resumen del Cambio

Forge614 Engram deja oficialmente de administrar **Gemini CLI**.

El conjunto oficial de asistentes de desarrollo soportados es exactamente:
1. **Claude Code** (`claude-code`)
2. **Codex** (`codex`)
3. **Cursor** (`cursor`)
4. **OpenCode** (`opencode`)
5. **Antigravity** (`antigravity`)

El ejecutable detectado para Antigravity es `agy` (o `agy.exe` en Windows). No se admiten comandos ni identidades como `gemini-cli`, `gemini` ni `connect antigravity`.

---

## 2. Antigravity: Integración MCP y Filosofía "MCP Only"

* **Protocolo estándar MCP:** Antigravity se comunica con Forge614 Engram mediante el protocolo estándar *Model Context Protocol* a través de canales estándar (`stdio`), permitiendo invocar las 10 herramientas nativas de memoria (`memory_context`, `memory_search`, `memory_save`, etc.).
* **Decisión del modelo:** Configurar MCP conecta las herramientas con el asistente, pero no garantiza que el modelo guarde recuerdos en cada interacción. El modelo decide de forma probabilística cuándo llamar a las herramientas.
* **Cobertura MCP Only:** Antigravity se configura exclusivamente en modo **MCP only**.
* **Sin ganchos (*hooks*):** No se instala ningún gancho automático para Antigravity. Los ganchos estarán disponibles únicamente si en el futuro existe un evento oficial, compatible y validado para recordatorios duraderos de memoria.
  > [!WARNING]
  > *Hooks are unavailable for Antigravity until a compatible official durable-memory event is verified.*

---

## 3. Ubicación y Estructura del Archivo de Configuración

En todos los sistemas operativos (macOS, Linux y Windows), Engram administra únicamente el archivo global:
```text
~/.gemini/config/mcp_config.json
```

Estructura conceptual administrada:
```json
{
  "mcpServers": {
    "forge614-engram": {
      "command": "/ruta/absoluta/a/forge614-engram",
      "args": ["mcp"]
    }
  }
}
```

* La propiedad `command` es la ruta absoluta al binario.
* `"args": ["mcp"]` es el único argumento.
* Se preservan comentarios y servidores ajenos en el archivo JSON.
* Si existe una entrada divergente para `forge614-engram`, se detiene la operación arrojando `CONFLICT`.
* Se generan respaldos privados con permisos `0600` y UUID antes de escribir.
* Se verifica el contenido de bytes posterior a la escritura.

---

## 4. Detección de Antigravity

El orden estricto de auditoría para detectar el ejecutable es:
1. Buscar `agy` en la variable de entorno `PATH`.
2. En macOS y Linux, buscar en `~/.local/bin/agy`.
3. En Windows, buscar en `%LOCALAPPDATA%/agy/bin/agy.exe`.

Detectar el ejecutable es una operación de solo lectura que **no modifica ningún archivo** hasta que el usuario lo seleccione y confirme explícitamente en el flujo de configuración (`setup` o `tui`).

---

## 5. Compatibilidad y Protección de Configuraciones Gemini Anteriores

* Engram deja de administrar Gemini CLI.
* No migra configuraciones de Gemini ni busca equivalencias.
* Engram **no lee, no modifica y no elimina** `~/.gemini/settings.json`. Si existe en la máquina, permanece intacto.
* El uso de la carpeta `.gemini` por parte de Antigravity no autoriza a Engram a tocar configuraciones heredadas de Gemini.

---

## 6. Seguridad de Rutas en Windows (Windows Path Guard)

* En macOS y Linux se validan permisos POSIX (`0700` y `0600`).
* En Windows, los permisos POSIX no reflejan las listas de control de acceso (ACLs) reales de NTFS.
* Por ello, Engram implementa una validación específica en Windows que **rechaza enlaces simbólicos (*symlinks*), uniones de directorios (*junctions*) y puntos de reanálisis (*reparse points*)** antes de escribir cualquier configuración.
* Esta protección evita que una ruta aparentemente normal redirija la escritura a una ubicación no autorizada.
* **Estado en CI:** La validación nativa en Windows está implementada y configurada en CI; permanece catalogada como **validación pendiente de CI hasta que el runner nativo de GitHub Actions confirme el resultado**.

---

## 7. Pruebas Automatizadas de Calidad

* Se verificó que Antigravity escribe solo en `~/.gemini/config/mcp_config.json`.
* Se verificó que `~/.gemini/settings.json` no cambia.
* Se verificó que Antigravity no crea ganchos ni registros en `hooks.json`.
* Se verificó que claves y servidores ajenos sobreviven a la inserción.
* Se verificó que configuraciones inválidas, conflictivas o tras enlaces inseguros son rechazadas.
* Se restauró la prueba de fallo parcial: si un asistente publica con éxito y el siguiente falla, Engram informa con veracidad el fallo parcial y preserva los respaldos privados.
* La ejecución nativa de Windows permanece pendiente de validación en CI.
