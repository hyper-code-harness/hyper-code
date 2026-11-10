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
    /** npm dependencies the package declares; bun installs them without scripts. */
    dependencies: Record<string, string>;
    /** Other plugins this one calls (procs.requires); they must be mounted before it is installed. */
    requires: string[];
    /** SHA-256 over file names and contents. */
    digest: string;
};
