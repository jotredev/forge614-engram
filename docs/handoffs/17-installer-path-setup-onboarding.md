# Handoff técnico 17: PATH de instaladores y onboarding de asistentes

Fecha de verificación: 2026-09-19 (UTC). Rama:
`feat/installer-path-setup-onboarding`. Commit de implementación verificado:
`f047693b9e27368d104cfc945c0e419af4a1d4b9`.

## Comportamiento entregado

Después de publicar el ejecutable con SHA-256 verificado, el instalador configura
su directorio en PATH para terminales futuras. Después de inicializar la memoria,
`forge614-engram setup` abre el selector de asistentes existente. La instalación
por sí sola no inscribe asistentes ni escribe su configuración.

Los comandos oficiales previstos, una vez integrado el cambio en `main` y
disponible una GitHub Release pública con sus artefactos, son:

```bash
curl -fsSL https://raw.githubusercontent.com/jotredev/forge614-engram/main/scripts/install.sh | bash
```

```powershell
irm https://raw.githubusercontent.com/jotredev/forge614-engram/main/scripts/install.ps1 | iex
```

Después se abre una terminal nueva y se ejecuta:

```text
forge614-engram setup
```

Los instaladores seleccionan la última GitHub Release, o una versión explícita
mediante `--version` / `-Version`, y verifican el binario contra `SHA256SUMS`
antes de publicarlo. Este trabajo no creó ni publicó una release, no hizo merge
y no creó ni empujó un tag `v*`. Los comandos que apuntan a `main` no distribuyen
automáticamente los cambios de esta rama.

## PATH y confirmación

| Plataforma / shell | Destino predeterminado del binario | Publicación de PATH |
| --- | --- | --- |
| macOS / Linux, zsh | `$HOME/.local/bin` | Bloque marcado en `~/.zshrc` |
| Linux, Bash | `$HOME/.local/bin` | Bloque marcado en `~/.bashrc` |
| macOS, Bash | `$HOME/.local/bin` | Bloque marcado en `~/.bash_profile` |
| macOS / Linux, fish | `$HOME/.local/bin` | `~/.config/fish/conf.d/forge614-engram.fish` |
| Windows | `%LOCALAPPDATA%\Forge614\bin` | Variable PATH del usuario mediante .NET y notificación de cambio del entorno |

Un directorio personalizado con `--bin-dir` / `-BinDir` recibe el mismo
tratamiento. En Unix, repetir la instalación reemplaza el bloque marcado sin
agregar otro y conserva el contenido ajeno al bloque. El instalador informa el
archivo modificado. Un shell desconocido deja los archivos de shell intactos y
recibe instrucciones manuales. Si no se puede publicar PATH, se conserva el
ejecutable verificado y se informa cómo añadir el directorio manualmente.

Windows conserva las entradas existentes y compara sin distinguir mayúsculas,
ignorando separadores finales, para no agregar otra entrada del directorio.
Modifica únicamente PATH del usuario, sin elevar privilegios ni escribir PATH
de máquina. No cambia el PATH del proceso actual; se debe abrir una terminal
nueva. Si falla la escritura, la instalación sigue disponible y se emite una
advertencia con el directorio que debe añadirse.

`setup` cierra su lector de terminal antes de entregar el control a la TUI de
asistentes. Cancelar el setup de memoria no abre esa TUI y conserva el código de
salida 130. Completar memoria abre la TUI una vez; cancelar después deja la
memoria inicializada y no convierte ese setup exitoso en un error.

La TUI sigue siendo responsable de detectar Claude Code, Codex, Cursor,
OpenCode y Antigravity, permitir selección/redetección, presentar archivos,
hooks, respaldos y advertencias, y aplicar únicamente después de confirmación
explícita. `init` sigue siendo no interactivo y no inscribe asistentes;
`assistant-list` sigue siendo de solo lectura y no crea `.forge614`.

## Archivos de la rama respecto de `main`

| Archivo | Cambio |
| --- | --- |
| `scripts/install.sh` | Publicación de PATH para shells Unix y recuperación manual |
| `scripts/install.ps1` | PATH del usuario en Windows y manejo del fallo de publicación |
| `scripts/__tests__/install.sh.test.ts` | Fixtures aislados de shell, repetición, directorio personalizado y PATH heredado |
| `scripts/__tests__/install.ps1.test.ps1` | Fixtures de PATH en memoria, comparación y fallo de escritura |
| `src/interfaces/terminal/setup.ts` | Coordinación del setup de memoria con la TUI existente |
| `src/interfaces/terminal/setup.test.ts` | Cancelación, entrega única y conservación de memoria |
| `src/interfaces/cli/commands.test.ts` | Contrato JSON y ausencia de inscripción de asistentes en `init` |
| `.github/workflows/release.yml` | Validación del resultado real de inspección nativa de los asistentes |
| `.github/workflows/verify.yml` | Ejecución nativa de la regresión del smoke test en Windows |
| `scripts/__tests__/release-windows-native-addon.test.ts` | Ejecuta la validación PowerShell del workflow con resultados sanos y bloqueados |
| `docs/superpowers/specs/2026-09-19-installer-path-setup-onboarding-design.md` | Diseño aprobado |
| `docs/superpowers/plans/2026-09-19-installer-path-setup-onboarding.md` | Plan de implementación |
| `docs/handoffs/17-installer-path-setup-onboarding.md` | Este registro técnico de evidencia |

No se modificaron README ni la documentación normal de instalación. Los
workflows se ajustaron únicamente por el defecto de verificación descrito abajo.

## Verificación local

Host: macOS ARM64; Bun `1.3.8`. El primer `bun test` del commit `a942251`
terminó con **535 pass, 13 skip, 0 fail**, 2,600 aserciones y 88 archivos.
Después de corregir la verificación del release, la suite completa terminó
con **536 pass, 13 skip, 0 fail**, 2,606 aserciones y 88 archivos.
Para esta última ejecución se suministró
`FORGE614_TEST_PWSH=/tmp/forge614-task4-pwsh.UVgyUs/pwsh`, una copia portátil
oficial de PowerShell `7.6.6` para macOS ARM64; no se modificó PATH ni se instaló
PowerShell en el sistema.

Los 13 skips locales se separan en **9 pruebas de PostgreSQL** porque
`FORGE614_TEST_POSTGRES_BIN` no estaba configurado, y **4 pruebas nativas de
Windows** porque el host local es macOS. La fixture completa `install.ps1` se
validó en Windows CI, no mediante emulación local. La nueva regresión del smoke
test requiere `pwsh` y se omite si no está disponible; sí se ejecutó en la
verificación local citada.

También finalizaron con código 0:

```text
bun run typecheck
git diff --check
bash -n scripts/install.sh scripts/install-from-source.sh
```

## Defecto observado y corrección de verificación

`assistant-list` devuelve los cinco IDs incluso si falla la carga del addon:
la inspección captura ese error y devuelve `configuration.status = blocked`.
Por eso comprobar solamente código de salida e IDs no demostraba que el addon
embebido hubiera cargado. Se reprodujo ejecutando el bloque PowerShell real del
workflow con un descriptor bloqueado: la prueba falló con
`Accepted blocked claude-code inspection` antes del cambio.

El commit `f047693` exige exactamente un resultado por asistente y estado
`absent` en el perfil temporal vacío. La regresión ejecuta el mismo bloque con
los cinco resultados sanos y con cada asistente bloqueado individualmente:
**2 pruebas del archivo, 0 fallos** después del cambio. Verify también ejecuta
esa regresión en Windows nativo.

## Evidencia remota

Ambas ejecuciones finalizaron con `conclusion: success` sobre `f047693`:

- [Verify](https://github.com/jotredev/forge614-engram/actions/runs/35427426902).
- [Release manual (`workflow_dispatch`)](https://github.com/jotredev/forge614-engram/actions/runs/35427429725).

| Job de Verify | Evidencia |
| --- | --- |
| [Unix, Ubuntu](https://github.com/jotredev/forge614-engram/actions/runs/35427426902/job/105855683011) | 543 pass, 6 skip, 0 fail; fixture Bash: 13 pass; typecheck, diff y sintaxis correctos |
| [Unix, macOS](https://github.com/jotredev/forge614-engram/actions/runs/35427426902/job/105855683022) | 545 pass, 4 skip, 0 fail; fixture Bash: 13 pass; typecheck, diff y sintaxis correctos |
| [Windows x64 nativo](https://github.com/jotredev/forge614-engram/actions/runs/35427426902/job/105855682910) | 15 pass, 2 skip, 0 fail en guard/publicación/regresión; `PASS install.ps1 fixture tests` |

PostgreSQL se ejecutó en ambos jobs Unix con sus binarios configurados; no quedó
omitido allí. Los cuatro skips de macOS son pruebas nativas Windows. Ubuntu
omite esas cuatro y las dos pruebas específicas de diagnóstico/PTY de macOS.
Windows omite dos pruebas que corresponden a hosts no Windows.

El job Windows ejecutó exactamente
`pwsh -NoProfile -File scripts/__tests__/install.ps1.test.ps1`. Los helpers usan
`PathReader` / `PathWriter` en memoria y un notificador vacío. Cada instalación
de fixture pasa `-ReleaseBaseUrl` de loopback, que utiliza un writer sin efectos
o el writer de error controlado. Ninguna de esas rutas llama al writer real del
PATH del usuario ni al notificador del entorno del runner.

| Job de release | Resultado |
| --- | --- |
| Release verification | Success; 543 pass, 6 skips de plataforma, 0 fail; fixture Bash: 13 pass |
| Build `forge614-engram-darwin-arm64` | Success |
| Build `forge614-engram-darwin-x64` | Success |
| Build `forge614-engram-linux-arm64` | Success |
| Build `forge614-engram-linux-x64` | Success |
| [Build `forge614-engram-windows-x64.exe`](https://github.com/jotredev/forge614-engram/actions/runs/35427429725/job/105855693402) | Success; addon x64 de 111,104 bytes y smoke de inspección correcto |
| [Build `forge614-engram-windows-arm64.exe`](https://github.com/jotredev/forge614-engram/actions/runs/35427429725/job/105855693431) | Success; addon ARM64 de 110,592 bytes y smoke de inspección correcto |
| [Assemble and validate release assets](https://github.com/jotredev/forge614-engram/actions/runs/35427429725/job/105856061453) | Success; seis entradas válidas de SHA-256 y seis verificaciones `OK` |
| Publish GitHub Release | **Skipped**, por ser un disparo manual sin tag |

Los dos ejecutables Windows ejecutaron `assistant-list` con HOME, USERPROFILE
y las rutas de configuración de los asistentes apuntando a un perfil temporal
bajo `RUNNER_TEMP`. Los cinco resultados únicos tuvieron estado `absent`; no
hubo inspecciones bloqueadas ni creación de `.forge614`. La inspección de los
ancestros llama al addon nativo: si no pudiera cargarse, el nuevo control de
estado haría fallar el job.

El log del ensamblado confirmó exactamente:

```text
forge614-engram-darwin-arm64: OK
forge614-engram-darwin-x64: OK
forge614-engram-linux-x64: OK
forge614-engram-linux-arm64: OK
forge614-engram-windows-x64.exe: OK
forge614-engram-windows-arm64.exe: OK
```

Se verificaron seis líneas de manifiesto, formato hexadecimal de 64 caracteres,
archivos no vacíos y permisos ejecutables de los cuatro binarios Unix. GitHub
Actions conserva seis artefactos individuales `release-forge614-engram-*` y el
paquete agregado `release-assets` (ID `10579302568`); son siete contenedores de
Actions para **seis binarios y un `SHA256SUMS`**, no una GitHub Release pública.

La primera ejecución manual, antes de reforzar el smoke test, fue
[35427228977](https://github.com/jotredev/forge614-engram/actions/runs/35427228977),
del commit `a942251`: seis builds y ensamblado correctos; publicación omitida.
La ejecución final es la evidencia aplicable a la comprobación reforzada del
addon.

El [Verify inicial 35427219939](https://github.com/jotredev/forge614-engram/actions/runs/35427219939)
del commit `a942251` quedó **cancelled**: macOS y Windows habían pasado, pero
Ubuntu seguía dentro de `bun test` sin más salida después de
`init is repeatable and rename retains identity without per-project registration`.
Se canceló la ejecución superada cuando Verify del commit final ya había pasado
en los tres sistemas. No se presenta ese intento como exitoso ni se atribuye una
causa no demostrada al bloqueo.

## Límites de la evidencia

GitHub Actions valida runners con herramientas de desarrollo preinstaladas.
Sigue pendiente probar instalación y ejecución en un Windows físico o VM limpio,
sin Bun, Node, Visual Studio ni dependencias de desarrollo añadidas; los runners
no certifican por sí solos independencia de MSVC CRT en esa instalación base.
Las fixtures de PATH usan almacenamiento en memoria o un writer sin efectos,
por lo que no verifican una escritura real del PATH personal ni la recepción
del aviso por una terminal gráfica recién abierta.

La suite Unix comprueba el contenido generado para zsh/Bash/fish y ejecuta el
bloque compatible de zsh/Bash mediante Bash; no certifica una sesión gráfica
interactiva nueva de cada shell. No se ejecutó la instalación oficial desde
`main` contra una nueva release pública porque esta tarea no publicó una.
