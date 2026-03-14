/**
 * Type-safe IPC Invoke Wrapper
 *
 * Eliminates repetitive `as { success, result, error }` casting in every store.
 * Provides a single function with consistent error handling.
 *
 * @example
 * ```ts
 * // Before (verbose, unsafe):
 * const result = (await window.electron.ipcRenderer.invoke('employee:list')) as {
 *   success: boolean;
 *   result?: Employee[];
 *   error?: string;
 * };
 * if (result.success) { ... }
 *
 * // After (concise, typed):
 * const employees = await ipc<Employee[]>('employee:list');
 * // Returns T directly, throws on failure
 *
 * // Or with error handling:
 * const result = await ipcSafe<Employee[]>('employee:list');
 * if (result.ok) { result.data... } else { result.error... }
 * ```
 */

/** Standard IPC response shape from all handlers */
interface IpcResponse<T> {
  success: boolean;
  result?: T;
  error?: string;
}

/** Result type for ipcSafe() — discriminated union */
export type IpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/**
 * Invoke an IPC channel and return the result directly.
 * Throws an Error if the handler returns `{ success: false }`.
 *
 * Use this in fire-and-forget or simple success/failure paths.
 */
export async function ipc<T>(channel: string, ...args: unknown[]): Promise<T> {
  const raw = await window.electron.ipcRenderer.invoke(channel, ...args);
  const response = raw as IpcResponse<T>;

  if (response.success) {
    return response.result as T;
  }

  throw new Error(response.error ?? `IPC call failed: ${channel}`);
}

/**
 * Invoke an IPC channel and return a discriminated result.
 * Never throws — caller must check `result.ok`.
 *
 * Use this when the store needs to handle errors explicitly (set error state, etc.)
 */
export async function ipcSafe<T>(channel: string, ...args: unknown[]): Promise<IpcResult<T>> {
  try {
    const raw = await window.electron.ipcRenderer.invoke(channel, ...args);
    const response = raw as IpcResponse<T>;

    if (response.success) {
      return { ok: true, data: response.result as T };
    }

    return { ok: false, error: response.error ?? `IPC call failed: ${channel}` };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

/**
 * Invoke an IPC channel that returns a raw value (no { success, result } wrapper).
 * Some legacy handlers (settings, etc.) return values directly.
 */
export async function ipcRaw<T>(channel: string, ...args: unknown[]): Promise<T> {
  return (await window.electron.ipcRenderer.invoke(channel, ...args)) as T;
}
