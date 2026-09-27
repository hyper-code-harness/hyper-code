/** A resolved app window that desktop actions address: host, process id, CGWindowID, app name, title and bounds in screen points. */
export type AppWindow = { host: string; pid: number; windowId: number; app: string; title: string; bounds: { x: number; y: number; width: number; height: number } };
