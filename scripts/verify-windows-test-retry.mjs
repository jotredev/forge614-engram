/**
 * Decide si un archivo de pruebas Windows merece un único reintento por el cierre intermitente
 * de Bun 1.4.2. Las corridas 38616906739 y 38623385845 registraron ese fallo; se eliminará
 * cuando Bun lo corrija. Un fallo de prueba normal nunca se oculta con un reintento.
 */
export function shouldRetryBunCrash(code, output, alreadyRetried = false) {
  return !alreadyRetried && code !== 0 && /(Bun has crashed|panic\(main thread\))/.test(output);
}
