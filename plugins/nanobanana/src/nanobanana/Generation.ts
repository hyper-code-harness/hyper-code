export type Generation = {
  /** Files written for generated images. */
  files: string[];
  /** Vertex model used. */
  model: string;
  /** Google Cloud project billed for the request. */
  project: string;
  /** Requested output resolution. */
  resolution: "1K" | "2K" | "4K";
  /** Requested aspect ratio. */
  aspectRatio: string;
  /** Text parts returned alongside images, if any. */
  text: string[];
  /** Usage metadata returned by Vertex AI. */
  usage?: Record<string, number>;
};
