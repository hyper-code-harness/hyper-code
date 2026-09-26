export type Paper = {
    source: "pubmed" | "europepmc";
    id: string;
    pmid: string | null;
    pmcid: string | null;
    doi: string | null;
    title: string;
    abstract: string;
    authors: string[];
    journal: string;
    published: string;
    publicationTypes: string[];
    meshTerms: string[];
    citedByCount: number | null;
    openAccess: boolean | null;
    /** Jev semantic relevance probability when semantic reranking was used. */
    relevanceScore?: number;

    url: string;
};
