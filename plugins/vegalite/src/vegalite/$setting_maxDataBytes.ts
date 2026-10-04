// A static SVG of a million points is neither readable nor cheap, and the file
// is read fully into memory before parsing. Cap it where charts stay charts.
export default {
    type: 'number',
    env: 'VEGALITE_MAX_DATA_BYTES',
    default: 8388608,
    title: 'Max data file size (bytes)',
    description: 'Largest data file a chart spec or /vegalite/data may read. A bigger file is refused with its size rather than loaded.',
};
