export default {
    type: "boolean",
    default: true,
    env: "TSGO_TYPECHECK",
    title: "Typecheck eval with tsgo",
    description: "Typecheck eval code in the out-of-process TypeScript 7 (tsgo) language server so the event loop never blocks. When off or unavailable, the in-process TypeScript Language Service is used.",
};
