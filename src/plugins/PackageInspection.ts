/** What a staged plugin package contains, as read by plugins.inspectPackage. */
export type PackageInspection = {
    name: string;
    version?: string;
    /** procs.src relative directory. */
    src: string;
    /** Runtime namespaces: directories directly under src. */
    namespaces: string[];
    /** Plugin files, sorted; node_modules, .git and bun's .bun-tag are excluded. */
    files: string[];
    /** npm dependencies the package declares; bun installs them exactly as the committed bun.lock says. */
    dependencies: Record<string, string>;
    /** npm packages whose install scripts the author asks to run (package.json trustedDependencies); every other script stays off. */
    trustedDependencies: string[];
    /** Names of the other plugins this one calls (procs.requires); they must be mounted before it is installed. */
    requires: string[];
    /** The same plugins with the version range each must satisfy; `*` when procs.requires gives only the name. */
    requiresRanges: Record<string, string>;
    /** SHA-256 over file names and contents. */
    digest: string;
};
