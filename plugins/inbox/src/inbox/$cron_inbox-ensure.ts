/** Keep the inbox receive loop running (it is a no-op while inbox.enabled is off). */
export default { fn: "inbox.ensure", every: "1m", now: true, args: {} };
