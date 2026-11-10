/** A previewed or applied change of the PLUGIN_HOST package, produced by plugins.bunInstall. */
export type HostChange = {
    operation: 'install' | 'update' | 'remove' | 'rollback';
    name: string;
    /** bun spec written to the host package.json; absent for remove. */
    spec?: string;
    /** The lock line bun resolved, e.g. the exact commit and integrity. */
    resolved?: string;
    plugin?: types.plugins.PackageInspection;
    /** Files compared with the currently installed copy. */
    added: string[];
    removed: string[];
    changed: string[];
    /** Plugins added in the same step because the plugin requires them (opts.with). */
    companions?: Array<{ name: string; spec: string; version?: string; namespaces: string[] }>;
    /** Packages the host has after the change that it did not have before (the plugin and its libraries). */
    newPackages: string[];
    /** bun's note about install scripts it refused to run, if any. */
    blockedScripts?: string;
    /** Binds spec, resulting bun.lock and plugin content; confirm must repeat it. */
    digest: string;
    status: 'preview' | 'applied' | 'applied-load-failed';
    loadError?: string;
};
