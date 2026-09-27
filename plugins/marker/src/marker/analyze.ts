/** Analyzes Marker Markdown and its generated artifacts for structural completeness and likely extraction problems.
 * Use after conversion, or on an existing Marker output, to inspect headings, tables, equations,
 * images, page markers, suspicious text, source-page coverage, and actionable warnings.
 */
export default async function (
    _ctx: Context,
    _session: Session | null,
    opts: {
        /** Absolute path to the Markdown file produced by Marker. */
        markdownPath: string;
        /** Optional absolute source PDF path used to compare source and output page counts. */
        sourcePdf?: string;
        /** Maximum suspicious snippets returned in the report. @default 12 @minimum 1 @maximum 50 */
        maxSamples?: number;
    },
): Promise<{
    markdownPath: string;
    sourcePdf?: string;
    bytes: number;
    characters: number;
    words: number;
    lines: number;
    nonEmptyLines: number;
    headings: { total: number; byLevel: Record<string, number> };
    tables: { pipeRows: number; separatorRows: number; estimatedTables: number; htmlTables: number; htmlRows: number };
    equations: { display: number; inline: number };
    images: { references: number; missing: string[] };
    links: number;
    codeFences: number;
    pageMarkers: number;
    sourcePages: number | null;
    outputToSourcePageRatio: number | null;
    suspicious: { replacementCharacters: number; controlCharacters: number; hyphenatedLineBreaks: number; veryLongLines: number; repeatedLines: number };
    suspiciousSamples: string[];
    warnings: string[];
    score: number;
    preview: string;
    quality: { text: number; layout: number; tables: number; clinicalSafety: number };
    reviewStatus: "pass" | "review" | "manual-verification-required";
    clinicalChecks: { numericTokens: number; units: Record<string, number>; inconsistentTableRows: number; mergedNumericCells: number; suspiciousLabels: string[]; implausibleBloodPressureRows: number };
}> {
    const path = await import("node:path");
    const markdownPath = path.resolve(opts.markdownPath);
    const file = Bun.file(markdownPath);
    if (!(await file.exists())) throw new Error(`marker.analyze: Markdown file not found: ${markdownPath}`);
    const text = await file.text();
    const lines = text.replace(/\r\n/g, "\n").split("\n");
    const nonEmpty = lines.filter((line) => line.trim());
    const headingLevels: Record<string, number> = {};
    for (const line of lines) {
        const match = line.match(/^(#{1,6})\s+\S/);
        if (match) headingLevels[`h${match[1]!.length}`] = (headingLevels[`h${match[1]!.length}`] ?? 0) + 1;
    }
    const pipeRows = lines.filter((line) => /^\s*\|.*\|\s*$/.test(line)).length;
    const separatorRows = lines.filter((line) => /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*$/.test(line)).length;
    const htmlTables = (text.match(/<table\b/gi) ?? []).length;
    const imageMatches = [...text.matchAll(/!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)];
    const htmlRows = (text.match(/<tr\b/gi) ?? []).length;
    const tableRows = lines.filter((line) => /^\s*\|.*\|\s*$/.test(line));
    const tableWidths = tableRows.map((line) => Math.max(0, line.split("|").length - 2));
    const widthFrequency = new Map<number, number>();
    for (const width of tableWidths) widthFrequency.set(width, (widthFrequency.get(width) ?? 0) + 1);
    const dominantWidth = [...widthFrequency.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
    const inconsistentTableRows = tableWidths.filter((width) => dominantWidth && width !== dominantWidth).length;
    const mergedNumericCells = tableRows.reduce((sum, line) => sum + line.split("|").filter((cell) => /\b\d+(?:[.,]\d+)?\s+\d+(?:[.,]\d+)?\b/.test(cell) && !/\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b/.test(cell)).length, 0);
    const suspiciousLabels = [...new Set((text.match(/\b(?:Нога|Finai|Moo|Pec\.|Pel\s+cicadiao|CARDIONIBITORIA)\b/giu) ?? []).map((value) => value.slice(0, 80)))];
    const numericTokens = (text.match(/(?<![\p{L}\p{N}])[-+]?\d+(?:[.,]\d+)?(?![\p{L}\p{N}])/gu) ?? []).length;
    const knownUnits = ["mmHg", "bpm", "mg/dL", "g/dL", "mmol/L", "µl", "mL/min", "%"];
    const units: Record<string, number> = {};
    for (const unit of knownUnits) units[unit] = (text.match(new RegExp(unit.replace("/", "\\/"), "gi")) ?? []).length;
    let implausibleBloodPressureRows = 0;
    const bloodPressureTable = tableRows.some((line) => /\b(?:Sist[oó]lica|Diast[oó]lica|P\.\s*A\.|mmHg)\b/i.test(line));
    if (bloodPressureTable) {
        for (const line of tableRows) {
            if (/^-+|Resultado|Referência|Média|Carga/i.test(line)) continue;
            const cells = line.split("|").slice(1, -1).map((cell) => cell.replace(/<[^>]+>/g, " ").trim());
            const timeIndex = cells.findIndex((cell) => /\b\d{1,2}:\d{2}\b/.test(cell));
            if (timeIndex < 0) continue;
            const values = cells.slice(timeIndex + 1).map((cell) => cell.match(/^\s*(\d{2,3})(?:\s|$)/)?.[1]).filter((value): value is string => Boolean(value)).map(Number).filter((n) => n >= 30 && n <= 260);
            if (values.length >= 2 && values[0]! <= values[1]!) implausibleBloodPressureRows++;
        }
    }
    const missingImages: string[] = [];
    for (const match of imageMatches) {
        const target = match[1]!;
        if (/^(?:https?:|data:)/i.test(target)) continue;
        const decoded = decodeURIComponent(target.replace(/^<|>$/g, ""));
        if (!(await Bun.file(path.resolve(path.dirname(markdownPath), decoded)).exists())) missingImages.push(target);
    }
    const normalizedCounts = new Map<string, number>();
    for (const line of nonEmpty) {
        const normalized = line.trim().replace(/\s+/g, " ");
        if (normalized.length >= 20) normalizedCounts.set(normalized, (normalizedCounts.get(normalized) ?? 0) + 1);
    }
    const repeated = [...normalizedCounts.entries()].filter(([, count]) => count >= 3);
    const suspiciousLines = lines.filter((line) => /�|(?:\b\w\s+){8,}\w\b|\?{4,}|_{8,}|\.{8,}/u.test(line));
    const sourcePdf = opts.sourcePdf ? path.resolve(opts.sourcePdf) : undefined;
    let sourcePages: number | null = null;
    if (sourcePdf && await Bun.file(sourcePdf).exists()) {
        const proc = Bun.spawn(["pdfinfo", sourcePdf], { stdout: "pipe", stderr: "pipe" });
        const stdout = await new Response(proc.stdout).text();
        await proc.exited;
        const match = stdout.match(/^Pages:\s+(\d+)/m);
        if (match) sourcePages = Number(match[1]);
    }
    const markerIndexes = new Set<number>();
    for (const match of text.matchAll(/(?:^|\n)\{(\d+)\}-{3,}(?=\n|$)/g)) markerIndexes.add(Number(match[1]));
    for (const match of text.matchAll(/id=["']page-(\d+)(?:-\d+)?["']/gi)) markerIndexes.add(Number(match[1]));
    const namedPageMarkers = (text.match(/(?:^|\n)(?:-{3,}\s*)?\{?\s*(?:page|страница)\s*\d+\s*\}?(?:\s*-{3,})?(?=\n|$)/gi) ?? []).length;
    const pageMarkers = markerIndexes.size || namedPageMarkers;
    const outputToSourcePageRatio = sourcePages && pageMarkers ? Number((Math.min(pageMarkers, sourcePages) / sourcePages).toFixed(3)) : null;
    const replacementCharacters = (text.match(/�/g) ?? []).length;
    const controlCharacters = (text.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g) ?? []).length;
    const hyphenatedLineBreaks = (text.match(/[\p{L}\p{N}]-\n[\p{Ll}]/gu) ?? []).length;
    const veryLongLines = lines.filter((line) => line.length > 2000).length;
    const warnings: string[] = [];
    if (text.trim().length < 100) warnings.push("Output is nearly empty; the PDF may require forced OCR.");
    if (replacementCharacters) warnings.push(`Found ${replacementCharacters} Unicode replacement character(s), suggesting decoding or OCR loss.`);
    if (controlCharacters) warnings.push(`Found ${controlCharacters} unexpected control character(s).`);
    if (missingImages.length) warnings.push(`${missingImages.length} referenced image artifact(s) are missing.`);
    if (hyphenatedLineBreaks > 5) warnings.push(`Found ${hyphenatedLineBreaks} probable line-break hyphenation artifacts.`);
    if (repeated.length > 3) warnings.push("Several lines repeat three or more times; headers, footers, or duplicate OCR may remain.");
    if (sourcePages && text.trim().length / sourcePages < 250) warnings.push("Very little extracted text per source page; inspect whether OCR was needed.");
    if (veryLongLines) warnings.push(`${veryLongLines} line(s) exceed 2,000 characters; paragraph or table structure may be flattened.`);
    if (sourcePages && pageMarkers && pageMarkers < sourcePages) warnings.push(`Detected output markers for ${pageMarkers} of ${sourcePages} source page(s); inspect possible omissions.`);
    if (inconsistentTableRows > Math.max(2, tableRows.length * 0.1)) warnings.push(`${inconsistentTableRows} table row(s) have a non-dominant column count.`);
    if (mergedNumericCells > 3) warnings.push(`${mergedNumericCells} table cell(s) may contain merged numeric measurements.`);
    if (suspiciousLabels.length) warnings.push(`Suspicious OCR labels detected: ${suspiciousLabels.join(", ")}.`);
    if (implausibleBloodPressureRows) warnings.push(`${implausibleBloodPressureRows} possible blood-pressure row(s) have non-descending measurements; verify column alignment.`);
    let score = 100;
    score -= Math.min(35, warnings.length * 7);
    score -= Math.min(15, missingImages.length * 3);
    score -= Math.min(15, replacementCharacters);
    score -= Math.min(10, Math.floor(hyphenatedLineBreaks / 3));
    const textQuality = Math.max(0, 100 - Math.min(35, replacementCharacters * 3 + controlCharacters * 2 + Math.floor(hyphenatedLineBreaks / 2)));
    const layoutQuality = Math.max(0, 100 - Math.min(45, veryLongLines * (htmlTables ? 0 : 2) + repeated.length * 2 + (sourcePages && pageMarkers && pageMarkers < sourcePages ? 20 : 0)));
    const tableQuality = tableRows.length ? Math.max(0, 100 - Math.min(70, inconsistentTableRows * 3 + mergedNumericCells * 2 + suspiciousLabels.length * 8)) : htmlTables ? Math.max(0, 100 - suspiciousLabels.length * 8) : 100;
    const clinicalSafety = Math.max(0, 100 - Math.min(80, suspiciousLabels.length * 15 + mergedNumericCells * 3 + implausibleBloodPressureRows * 5 + replacementCharacters * 5));
    const reviewStatus: "pass" | "review" | "manual-verification-required" = numericTokens > 20 && (clinicalSafety < 90 || tableQuality < 85)
        ? "manual-verification-required"
        : warnings.length ? "review" : "pass";

    return {
        markdownPath,
        ...(sourcePdf ? { sourcePdf } : {}),
        bytes: file.size,
        characters: text.length,
        words: (text.match(/[\p{L}\p{N}]+/gu) ?? []).length,
        lines: lines.length,
        nonEmptyLines: nonEmpty.length,
        headings: { total: Object.values(headingLevels).reduce((a, b) => a + b, 0), byLevel: headingLevels },
        tables: { pipeRows, separatorRows, estimatedTables: separatorRows + htmlTables, htmlTables, htmlRows },
        equations: { display: (text.match(/\$\$[\s\S]*?\$\$/g) ?? []).length, inline: (text.match(/(?<!\$)\$(?!\$)[^\n$]+\$(?!\$)/g) ?? []).length },
        images: { references: imageMatches.length, missing: [...new Set(missingImages)] },
        links: (text.match(/(?<!!)\[[^\]]+\]\([^)]+\)/g) ?? []).length,
        codeFences: Math.floor((text.match(/^```/gm) ?? []).length / 2),
        pageMarkers,
        sourcePages,
        outputToSourcePageRatio,
        suspicious: { replacementCharacters, controlCharacters, hyphenatedLineBreaks, veryLongLines, repeatedLines: repeated.length },
        suspiciousSamples: suspiciousLines.slice(0, Math.max(1, Math.min(50, opts.maxSamples ?? 12))).map((line) => line.trim().slice(0, 300)),
        warnings,
        quality: { text: textQuality, layout: layoutQuality, tables: tableQuality, clinicalSafety },
        reviewStatus,
        clinicalChecks: { numericTokens, units, inconsistentTableRows, mergedNumericCells, suspiciousLabels, implausibleBloodPressureRows },
        score: Math.max(0, score),
        preview: nonEmpty.slice(0, 25).join("\n").slice(0, 4000),
    };
}
