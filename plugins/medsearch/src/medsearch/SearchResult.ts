export type SearchResult = {
    source: "pubmed" | "europepmc";
    query: string;
    total: number;
    nextCursor: string | null;
    papers: types.medsearch.Paper[];
};
