/** A repository fetched for looking at, before anything is installed — what skills.preview returns and skills.view shows. */
export type PackPreview = {
    /** Identifier of the preview; the clone is in ~/.hyper/.skills-staging/preview/<id>/repo. */
    id: string;
    repo: string;
    tag?: string;
    branch?: string;
    commit: string;
    /** Pack name the skills would be installed under. */
    pack: string;
    /** Pack already installed from this repository, when there is one. */
    installedAs?: string;
    trust: "official" | "community";
    found: string;
    select?: string[];
    ref?: string;
    skills: Array<{
        name: string; path: string; description: string; byModel: boolean; byUser: boolean; bodyChars: number; files: number; bytes: number;
        executables: string[]; diagnostics: string[]; hash: string;
        /** Against the installed copy: new (nothing installed), added, changed or same. */
        change: "new" | "added" | "changed" | "same";
    }>;
    skipped: Array<{ path: string; reason: string }>;
    /** Digest of the skills' content; an install of the same commit and selection has the same one. */
    content: string;
    createdAt: number;
};
