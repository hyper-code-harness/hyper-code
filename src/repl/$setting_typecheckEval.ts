export default {
    type: "boolean",
    default: true,
    env: "EVAL_TYPECHECK",
    title: "Typecheck eval before execution",
    description: "Reject invalid eval code before it runs. Checked by the out-of-process tsgo language server (setting tsgo.enabled), falling back to the in-process TypeScript Language Service.",
};
