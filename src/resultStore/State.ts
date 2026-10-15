import type { LRUCache } from 'lru-cache';
export type State = {
    cache?: LRUCache<string, { text: string; totalChars: number }>;
    pending?: Map<string, Promise<{ text: string; totalChars: number }>>;
};
