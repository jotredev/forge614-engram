# Forge614 Engram — Documentación Oficial (Español)

> **Etapa:** Etapa 1 — Memoria Local  
> **Estado:** Vigente y Actualizado  
> **Traducción hermana:** [Official English Documentation](../en/README.md)  
> **Entorno de compilación:** Bun >= 1.3.8 | SQLite (FTS5 con tokenizador trigram) | TypeScript 5.9 estricto  
> **Ejecutable autónomo:** `forge614-engram` en `$HOME/.local/bin/` (no requiere Bun en ejecución)  
> **Base de datos central:** `~/.forge614/engram.db` (en la carpeta del usuario)

---

## 1. Resumen Ejecutivo (¿Qué es en una sola frase?)

**Forge614 Engram** es una libreta de memoria personal centralizada en la carpeta de tu usuario (`~/.forge614/engram.db`), creada para que tus asistentes de inteligencia artificial y programas recuerden hechos, decisiones y procedimientos importantes a lo largo del tiempo, sin perder revisiones pasadas y encontrando notas al instante mediante un buscador interno explicable basado en SQLite FTS5 sin costo de tokens ni llamadas a la nube.

---

## 2. El Problema del Mundo Real que Resuelve

Cuando trabajas con asistentes de inteligencia artificial o programas cotidianos, te enfrentas a tres dificultades habituales:

1. **Amnesia al cerrar la conversación:** Cada vez que inicias un chat nuevo, el asistente olvida por completo los acuerdos previos, qué base de datos elegiste o qué reglas definiste.
2. **Ediciones destructivas (sobreescrituras sin rastro):** Si cambias una decisión importante, los sistemas tradicionales borran la nota anterior, perdiendo la historia de por qué cambiaste de opinión.
3. **Buscadores que funcionan como "cajas negras":** Muchos sistemas de búsqueda devuelven notas sin explicar por qué eligieron esa información ni qué palabras coincidieron.

Forge614 Engram resuelve esto guardando cada recuerdo en tu base central de usuario, manteniendo un árbol completo de versiones históricas (historial inmutable) y mostrando la fórmula matemática exacta que determina qué nota es más relevante al buscar.

---

## 3. La Analogía Maestra: El Archivero con Libreta de Auditoría

Imagina que contratas a un archivero muy metódico en tu oficina:

- **La Gaveta de Proyectos:** El archivero guarda todos los papeles en un archivo central (`~/.forge614/engram.db`), pero mantiene carpetas separadas para cada trabajo (`--project`). Los papeles de un proyecto jamás se mezclan con los de otro.
- **Las Fichas de Recuerdo:** Cada ficha contiene una nota clara: qué pasó, qué tipo de nota es (un hecho comprobado, una decisión de diseño, un procedimiento, una advertencia o una preferencia) y la fecha exacta.
- **El Archivador de Versiones:** Si decides actualizar las instrucciones sobre la base de datos de tu proyecto (`--topic architecture/database`), el archivero no destruye la ficha vieja; le saca una fotocopia fechada, la guarda en el archivador histórico de versiones y coloca la nueva ficha al frente con el número de versión siguiente.
- **El Sello de Seguridad contra Duplicados (Idempotencia):** Si tu mensajero intenta entregarle dos veces exactamente la misma nota con la misma orden de envío (`--request-key`), el archivero revisa su registro, reconoce el sello y te devuelve la ficha original sin gastar papel extra ni escribir duplicados.
- **El Índice Rápido:** Cuando buscas una palabra, el archivero consulta un fichero organizado alfabéticamente por fragmentos de tres letras (índice trigram) y te entrega las fichas que contienen todas tus palabras, explicándote el cálculo exacto de antigüedad y prioridad que usó para ordenarlas.

---

## 4. Principios Fundamentales del Sistema

- **100% Local y Privado:** No requiere claves de internet (API keys), no envía datos a la nube ni realiza llamadas a modelos remotos. No tiene telemetría ni rastreo.
- **Almacén Centralizado en Carpeta de Usuario:** La base se ubica por defecto en `~/.forge614/engram.db`, permitiendo compartir la memoria entre diferentes carpetas de trabajo mediante el aislamiento por `--project`.
- **Ejecutable Autónomo:** Compilado como binario nativo (`forge614-engram`) en `$HOME/.local/bin/`. No requiere tener Bun ni Node en PATH para usarse en el día a día.
- **Aislamiento Estricto por Proyecto:** Toda operación exige indicar a qué proyecto pertenece (`--project`). (Nota: esto es separación lógica interna de datos, no un sistema de contraseñas de usuarios).
- **Cero Borrado Permanente en esta Etapa:** Archivar un recuerdo (`archive`) únicamente lo oculta de las búsquedas activas. La nota y todas sus versiones permanecen intactas para consulta histórica o restauración (`restore`).
- **Guardado Manual en Etapa 1:** El sistema guarda cuando se le ordena (`save`). La integración automática con asistentes vía protocolo MCP llegará en la Etapa 2.

---

## 5. Índice Secuencial de Documentación en Español

Explora la documentación siguiendo el orden cronológico de aprendizaje:

1. [**01. Instalación y Primeros Pasos (`01-instalacion-y-primeros-pasos.md`)**](01-instalacion-y-primeros-pasos.md): Requisitos de Bun, script de instalación, configuración del PATH y tu primer recuerdo guardado.
2. [**02. Recorrido Guiado del Sistema (`02-recorrido-guiado.md`)**](02-recorrido-guiado.md): Tutorial paso a paso que cubre el ciclo de vida completo de un recuerdo (guardar, revisar, buscar, archivar y auditar).
3. [**03. Referencia Completa de Terminal (`03-referencia-cli.md`)**](03-referencia-cli.md): Cada comando de consola documentado individualmente con sus opciones, ejemplos reales y formato de respuesta en JSON.
4. [**04. Guía del SDK de TypeScript (`04-sdk-typescript.md`)**](04-sdk-typescript.md): Cómo importar la clase `MemoryStore` en tu código fuente y gestionar memorias programáticamente.
5. [**05. Arquitectura Interna y Fórmulas (`05-arquitectura-interna-y-formulas.md`)**](05-arquitectura-interna-y-formulas.md): Estructura de las tablas SQLite, disparadores automáticos, tokenizador trigram FTS5, desglose profundo de BM25 y fórmulas de ordenamiento.
6. [**06. Resolución de Problemas y Errores (`06-resolucion-de-errores.md`)**](06-resolucion-de-errores.md): Tabla completa con todos los códigos de error (`INVALID_INPUT`, `VERSION_CONFLICT`, etc.), causas explicadas y qué hacer.
7. [**07. Glosario en Lenguaje Cotidiano (`07-glosario.md`)**](07-glosario.md): Definición sencilla de cada concepto técnico utilizado en el proyecto.
8. [**08. Límites y Hoja de Ruta (`08-limites-y-roadmap.md`)**](08-limites-y-roadmap.md): Capacidades resueltas en Etapa 1, comparativa frente a Gentleman y Softmax, diseño aprobado de identidad (`idProject`), y nuevo orden de trabajo de 6 fases.
