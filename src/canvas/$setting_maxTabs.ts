export default {
    type: 'number',
    default: 0,
    title: 'Unpinned canvas tabs kept open',
    description: 'Off by default (0): tabs are never closed for the person — a crowded strip shrinks its tabs and the All tabs list reaches every one. Set a number to have a chat put away its least recently shown unpinned tabs beyond that many into Recently closed (kept 30 days, reopen brings them back with their state); canvas.show then says which ones in `hint`. Pinned tabs never count and are never put away.',
};
