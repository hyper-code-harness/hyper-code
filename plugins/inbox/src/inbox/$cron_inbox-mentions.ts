/** Mail @mentions still unread after a minute to the mentioned people's inboxes (a no-op while inbox.enabled is off). */
export default { fn: "inbox.mailMentions", every: "1m", args: {} };
