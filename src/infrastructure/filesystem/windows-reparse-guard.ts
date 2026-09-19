type WindowsReparsePointChecker = (path: string) => unknown;

export function checkWindowsReparsePoint(path: string, checker: WindowsReparsePointChecker): boolean {
  const result = checker(path);
  if (typeof result !== "boolean") throw new Error("Windows reparse-point checker returned an invalid result.");
  return result;
}

export function hasWindowsReparsePoint(path: string): boolean {
  if (process.platform !== "win32") throw new Error("Windows reparse-point checks require Windows.");
  return checkWindowsReparsePoint(path, nativePath => {
    const addon = require("../../../native/windows-reparse-guard/build/Release/windows_reparse_guard.node") as {
      hasWindowsReparsePoint: WindowsReparsePointChecker;
    };
    return addon.hasWindowsReparsePoint(nativePath);
  });
}
