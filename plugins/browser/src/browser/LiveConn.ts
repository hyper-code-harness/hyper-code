// One live-view viewer bridged to Chrome: created by browser.liveConnect, owned by
// the `/browser/live` WebSocket, closed when that socket closes.
export type LiveConn = {
    /** Chrome target currently shown. */
    targetId: () => string;
    /** Handle one JSON message from the viewer page. */
    handle: (message: string) => Promise<void>;
    /** The socket drained: send the newest frame that was held back. */
    drain: () => void;
    /** Stop the screencast, undo focus emulation, detach and close the CDP socket. */
    close: () => Promise<void>;
    /** Counters for liveViewStatus. */
    stats: () => { frames: number; dropped: number; inputs: number; since: number; mode: "auto" | "high" | "low"; level: number; quality: number; maxWidth: number; maxHeight: number };
};
