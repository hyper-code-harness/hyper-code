/**
 * Returns the dedicated Google Cloud project used for Nano Banana image work.
 * Use this instead of the ambient gcloud project so marketing generations are
 * billed and audited in the Hyper project.
 */
export default async function (_ctx: Context, _session: Session | null, opts: {
  /** Explicit project override. */ project?: string;
}): Promise<string> {
  return opts.project ?? "hs-hyper-code";
}
