# Límites de la Etapa 1 y Hoja de Ruta Futura

> **Etapa:** Etapa 1 — Memoria Local  
> **Estado:** Vigente y Activo  
> **Traducción hermana:** [English Version](../en/08-boundaries-and-08-limites-y-roadmap.md)

Este documento declara con absoluta transparencia qué capacidades se encuentran implementadas y probadas en esta **Etapa 1**, qué limitaciones técnicas existen actualmente y cuáles son las funcionalidades previstas para etapas futuras.

---

## 1. Capacidades Completadas y Verificadas (Etapa 1)

Las siguientes funciones están 100% implementadas en el código fuente de este repositorio y han sido verificadas mediante la suite de pruebas automatizadas (`bun test`):

- [x] **Motor de base de datos relacional local:** Almacenamiento SQLite gestionado mediante `bun:sqlite` en modo WAL con integridad referencial (`foreign_keys`) y tiempo de espera (`busy_timeout = 5000ms`).
- [x] **Historial inmutable de versiones:** Cada actualización de una memoria temática preserva una copia snapshot de su contenido en `memory_versions`.
- [x] **Control de concurrencia optimista:** Actualizar un tema exige especificar la versión esperada (`expectedVersion`), impidiendo que dos procesos pisen notas sin leerlas antes.
- [x] **Prevención de duplicados (Idempotencia):** Soporte para `requestKey` con verificación criptográfica de huella digital SHA-256.
- [x] **Búsqueda textual explicable:** Motor FTS5 con tokenizador trigram y ponderación por campos (título: 5.0, tema: 3.0, contenido: 1.0).
- [x] **Fórmula matemática de relevancia:** Combinación de puntuación BM25, multiplicador de notas prioritarias (`pinned`) y factor de decaimiento por antigüedad temporal ($r$).
- [x] **Modo literal de respaldo:** Búsqueda transparente para términos cortos de menos de 3 caracteres (como `"UI"` o `"DB"`), insensible a mayúsculas y acentos Unicode.
- [x] **Visibilidad reversible:** Archivar notas para retirarlas de las búsquedas activas sin borrar su historia y restaurarlas en cualquier momento.
- [x] **Herramienta de terminal robusta (CLI):** Validación estricta previa a la apertura de base de datos, salida JSON estructurada y gestión de errores con códigos de salida normalizados.
- [x] **SDK para TypeScript:** Clase `MemoryStore` lista para ser importada en proyectos internos.

---

## 2. Límites y Aspectos No Implementados en Esta Etapa

Para evitar falsas expectativas, es fundamental tener presentes las siguientes restricciones de la Etapa 1:

1. **Búsqueda estrictamente literal (sin vectores de significado):**  
   El buscador actual analiza únicamente coincidencias de palabras exactas. No comprende sinónimos, paráfrasis ni conceptos afines (por ejemplo, buscar *"automóvil"* no encontrará notas que hablen de *"coche"*).
2. **Sin presupuesto de palabras (Tokens de IA):**  
   El comando `search` devuelve el contenido completo de cada recuerdo coincidente. Aún no existe un limitador que recorte o comprima el texto para ajustarse al presupuesto de contexto de un modelo de lenguaje.
3. **Sin servidor de red ni protocolo MCP:**  
   En esta etapa no hay un servidor HTTP local ni un adaptador de protocolo MCP (*Model Context Protocol*) para conectar Claude Desktop, Windsurf o Cursor mediante enchufes de red. El acceso es exclusivamente local vía terminal (`cli.ts`) o código (`src/index.ts`).
4. **Sin sesiones de conversación ni resúmenes de relevo:**  
   No existe el concepto de sesión de trabajo ni comandos automáticos de cierre o relevo de tareas.
5. **Sin sistema de estrellas ni aprendizaje por refuerzo:**  
   No hay calificación de utilidad de recuerdos (`success` / `failure`) ni cálculo de saliencia efectiva.
6. **Sin exportación ni importación de respaldo:**  
   Las funciones `archive` y `restore` solo alteran la visibilidad de las notas. No existe aún un comando para empaquetar o exportar la base de datos a archivos JSON/ZIP externos.
7. **Sin borrado permanente:**  
   No existe un comando `delete` para eliminar filas de forma destructiva; las notas obsoletas se conservan archivadas.

---

## 3. Hoja de Ruta hacia las Siguientes Etapas

El desarrollo de Forge614 Engram continuará en entregas modulares programadas:

```
┌─────────────────────────────────┐
│   Etapa 1: Memoria Local        │  ◄── (ETAPA ACTUAL COMPLETADA)
│   SQLite + FTS5 + CLI + SDK     │
└────────────────┬────────────────┘
                 │
                 ▼
┌─────────────────────────────────┐
│   Etapa 2: Sesiones y Protocolos│
│   Servidor MCP + HTTP Local     │
│   Resúmenes de sesión de trabajo│
└────────────────┬────────────────┘
                 │
                 ▼
┌─────────────────────────────────┐
│   Etapa 3: Recuperación Semántica│
│   Vectores locales (Embeddings) │
│   Fusión RRF + Filtro MMR       │
│   Presupuesto estricto de tokens│
└────────────────┬────────────────┘
                 │
                 ▼
┌─────────────────────────────────┐
│   Etapa 4: Ciclo de Aprendizaje │
│   Calificación de éxito/fracaso │
│   Consolidación y sueño         │
│   Exportación segura de respaldos│
└─────────────────────────────────┘
```
