export default {
    type: 'number',
    default: 12,
    title: 'Unpinned canvas tabs kept open',
    description: 'When a chat opens more unpinned canvas tabs than this, the ones shown least recently are put away into Recently closed (kept 30 days, reopen brings them back with their state). Pinned tabs never count and are never put away. 0 turns it off.',
};
