/** Safe configuration metadata for one mounted plugin; secret values are never exposed. */
export type ConfigurationResult = {
    name: string;
    settings: Array<{
        name: string;
        module: string;
        key: string;
        descriptor: { type: string; title?: string; description?: string; env?: string; default?: string | number | boolean | null; options?: string[]; min?: number; max?: number };
        currentValue?: string | number | boolean | null;
        source: 'db' | 'env' | 'default';
        secret: boolean;
        configured: boolean;
    }>;
    /** Secret references and presence only; values never returned or decrypted. */
    secrets: Array<{name: string; ref: string; title?: string; description?: string; required?: boolean; configured: boolean}>;
    widget: string | null;
};
