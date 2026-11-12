/** Once a day, look for newer releases of the installed plugins (nothing is installed: plugins.checkUpdates only records what it finds). */
export default { fn: "plugins.checkUpdates", every: "1d", now: true, args: {} };
