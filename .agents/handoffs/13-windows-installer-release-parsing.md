# Windows installer: reliable release metadata parsing

Fecha: 2026-09-18. Rama: `feat/cross-platform-setup`.
Estado: corrección implementada en `scripts/install.ps1` y suite de validación nativa `scripts/__tests__/install.ps1.test.ps1` reforzada.
Distribución: no modifica el flujo público visible para usuarios ni las opciones de línea de comandos.

---

## 1. Analogía de la Vida Cotidiana: La Carta Sellada y la Trituradora

Imaginemos que una oficina postal envía un contrato importante dentro de un paquete sellado. Si el recepcionista toma el paquete completo, lo abre y despliega las hojas sobre su escritorio, puede leer los artículos y verificar las firmas oficiales sin ningún problema. 

Sin embargo, supongamos que el recepcionista comete el error de meter el paquete sellado directamente en una ranura trituradora que corta y arroja astilla por astilla a la mesa de trabajo de su supervisor. Cuando el supervisor intenta leer el contrato a partir de esas virutas individuales, no encuentra ningún párrafo con sentido ni el sello notarial de autenticación; por tanto, declara frustrado: *"El contrato llegó incompleto y le falta el sello notarial"*.

Eso es exactamente lo que ocurría en Windows PowerShell: `Invoke-WebRequest` entregaba el cuerpo HTTP de la API no como un texto decodificado (`System.String`), sino empaquetado en un arreglo crudo de bytes (`System.Byte[]`). Al enviar ese arreglo mediante la tubería (`|`) hacia `ConvertFrom-Json`, PowerShell desempaquetaba la colección y pasaba cada byte numérico individualmente por la tubería. Como consecuencia, el deserializador no podía reconstruir el árbol JSON, el arreglo de archivos (`assets`) quedaba nulo o vacío, y el instalador reportaba falsamente que faltaba el manifiesto de firmas criptográficas `SHA256SUMS`.

---

## 2. Contexto y Propósito del Instalador de Windows (`scripts/install.ps1`)

El instalador nativo de Windows (`scripts/install.ps1`) descarga de forma segura los metadatos de una GitHub Release (o de un servidor de pruebas local durante integración continua) con el objetivo exclusivo de localizar dos elementos indispensables dentro del arreglo `assets`:

1. **`SHA256SUMS`**: el manifiesto oficial con las sumas de comprobación criptográficas SHA-256 de todos los artefactos de la versión.
2. **El binario ejecutable exacto para la arquitectura de la máquina anfitriona**:
   - `forge614-engram-windows-x64.exe` para procesadores de 64 bits estándar (**AMD64** / `x86_64`).
   - `forge614-engram-windows-arm64.exe` para arquitectura **ARM64**.

Una vez identificados estos dos recursos mediante sus URLs de descarga (`browser_download_url`), el instalador descarga el binario a una carpeta temporal protegida, calcula su hash SHA-256 local y lo compara byte a byte con la firma provista en `SHA256SUMS` antes de publicar el ejecutable en `$env:LOCALAPPDATA\Forge614\bin\forge614-engram.exe`.

---

## 3. Causa Raíz del Fallo: Incompatibilidad de Tipos en el Pipeline de PowerShell

En Windows PowerShell (particularmente en Desktop PowerShell 5.1 y ciertas configuraciones de PowerShell Core), `Invoke-WebRequest -UseBasicParsing` emite un objeto de respuesta cuya propiedad `.Content` puede ser devuelta como un arreglo de bytes (`System.Byte[]`) en lugar de una cadena de texto, dependiendo de los encabezados HTTP emitidos por el servidor o de la negociación de transporte.

### Comportamiento anterior (vulnerable):
```powershell
# Código anterior
$releaseResponse = Invoke-WebRequest -Uri $releaseJsonUrl -UseBasicParsing
$release = $releaseResponse.Content | ConvertFrom-Json
```

Cuando `$releaseResponse.Content` contenía un `[byte[]]`:
1. El operador de tubería de PowerShell (`|`) realiza un *unrolling* o desenrollado automático de colecciones, enviando cada `System.Byte` de forma secuencial al siguiente comando.
2. `ConvertFrom-Json` espera cadenas de texto con sintaxis JSON válida, no una ráfaga de enteros de 8 bits.
3. El objeto resultante `$release` dejaba de ser un `PSCustomObject` con la estructura de la release; quedaba nulo, truncado o con su propiedad `assets` vacía.
4. Al evaluar:
   ```powershell
   $manifestAsset = @($release.assets | Where-Object { $_.name -eq 'SHA256SUMS' })
   if ($manifestAsset.Count -ne 1) { Stop-Install 'The release is missing SHA256SUMS.' }
   ```
   `$manifestAsset.Count` resultaba ser 0, y el instalador abortaba con el error confuso:
   ```text
   The release is missing SHA256SUMS.
   ```
   ocultando que el fallo real no era la ausencia del archivo en el servidor, sino la incapacidad de interpretar el JSON recibido como bytes.

---

## 4. Corrección Implementada: Decodificación Explícita y Parámetro `-InputObject`

La solución implementada en [`scripts/install.ps1`](file:///Users/jorgeetrejoo/Desktop/forge614-engram/scripts/install.ps1) garantiza que el contenido se normalice siempre a una única cadena UTF-8 antes del parseo, evitando por completo el desenrollado por tubería:

```powershell
# Corrección robusta
$releaseResponse = Invoke-WebRequest -Uri $releaseJsonUrl -UseBasicParsing
$releaseRawContent = $releaseResponse.Content
$releaseJson = if ($releaseRawContent -is [byte[]]) {
  [System.Text.Encoding]::UTF8.GetString($releaseRawContent)
} else {
  [string]$releaseRawContent
}
$release = ConvertFrom-Json -InputObject $releaseJson
```

### Mecánica de la corrección:
- **Detección de tipo (`-is [byte[]]`):** Si PowerShell entrega el payload como un bloque de bytes crudos, se invoca `[System.Text.Encoding]::UTF8.GetString($releaseRawContent)` para decodificar todo el bloque de manera atómica a una cadena UTF-8 completa.
- **Ruta textual transparente:** Si PowerShell ya entrega una cadena de texto (`[string]`), el instalador conserva esa ruta directamente sin costo de decodificación adicional.
- **Evitación de tubería (`-InputObject`):** Al pasar `$releaseJson` mediante `-InputObject` explícito, `ConvertFrom-Json` recibe la cadena íntegra como un solo argumento escalar, parseando fielmente el objeto de release con todas sus propiedades y su arreglo `assets`.

---

## 5. Garantías de Seguridad Invariables

Esta corrección técnica de parseo **no relaja ni reduce ninguna medida de seguridad**:

| Medida de Seguridad | Estado | Descripción |
| --- | --- | --- |
| **HTTPS obligatorio en producción** | Intacta | `Test-ReleaseUri` exige estrictamente el esquema `https://`. La única excepción son URLs loopback con puerto explícito usadas en pruebas locales mediante `-ReleaseBaseUrl`. |
| **Verificación estricta de `SHA256SUMS`** | Intacta | El instalador calcula el hash SHA-256 del binario descargado y exige coincidencia exacta con el manifiesto oficial antes de moverlo a producción. |
| **Protección contra sobrescritura** | Intacta | Si el archivo destino `forge614-engram.exe` ya existe, se rechaza la instalación a menos que el usuario proporcione explícitamente `-Force`. |
| **Sin ejecución de `setup`** | Intacta | El instalador únicamente copia el binario verificado; no invoca `forge614-engram setup` ni inicia asistentes. |
| **Sin modificación de PATH** | Intacta | No altera las variables de entorno del sistema ni del usuario; informa en pantalla las instrucciones manuales si es necesario. |
| **Sin creación de almacenamiento `~/.forge614`** | Intacta | No inicializa directorios de configuración ni crea la base `engram.db`. |
| **Sin alteración de asistentes** | Intacta | No lee, modifica ni genera archivos `.claude`, `.codex` ni configuraciones de Antigravity u otros clientes. |

---

## 6. Validación con Suite Nativa de Pruebas (`scripts/__tests__/install.ps1.test.ps1`)

La suite de pruebas nativas de Windows valida de extremo a extremo el comportamiento del instalador sin conexión a internet externa:

- **Servidor HTTP local efímero en loopback:** Utiliza `[System.Net.HttpListener]` escuchando exclusivamente en `127.0.0.1:<puerto_dinámico>`.
- **Simulación integral de GitHub Releases:**
  - Entrega metadatos JSON de la release serializados como bytes UTF-8 (`[Text.Encoding]::UTF8.GetBytes($payload)`).
  - Entrega el manifiesto criptográfico `SHA256SUMS`.
  - Entrega binarios ejecutables de prueba (*fixture binaries*) para **AMD64** y **ARM64**.
  - Simula casos de fallo: ruta corrupta `/mismatch/` con checksum incorrecto (valida rechazo y ausencia de binario) y reintento sobre destino existente sin `-Force` (valida protección contra sobrescritura).
- **Objetivo central de la prueba:** Garantizar que el instalador funcione correctamente cuando PowerShell recibe los metadatos como arreglo de bytes (`System.Byte[]`) y no únicamente cuando los recibe como texto plano.

---

## 7. Validación Pendiente y Criterio de Estabilidad Multiplataforma

Para declarar plenamente estable la distribución multiplataforma de Forge614 Engram, la siguiente prueba nativa debe ejecutarse exitosamente en el entorno de integración continua:

```powershell
pwsh -NoProfile -File scripts/__tests__/install.ps1.test.ps1
```

> [!IMPORTANT]
> **Criterio de Aceptación:** Esta prueba debe ejecutarse y superarse en **GitHub Actions sobre ejecutores `windows-latest`** como precondición obligatoria antes de publicar la versión final de la distribución binaria multiplataforma.
