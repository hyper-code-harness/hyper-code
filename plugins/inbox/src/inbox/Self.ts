/** Who this Hyper is on the mesh: relay origin, address host (agents are <id>@host) and the node principal its key is bound as. */
export type Self = { relay: string; host: string; principal: string; source: "settings" | "hyperlet" };
