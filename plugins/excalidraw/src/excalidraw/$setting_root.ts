// Where drawings live: <name>.excalidraw (the scene) and <name>.svg (the
// preview the editor exports on every save). Relative paths resolve against the
// project root, `~/` against the home directory.
export default {
    type: 'string',
    env: 'EXCALIDRAW_ROOT',
    default: 'drawings',
    title: 'Excalidraw drawings directory',
    description: 'Directory holding .excalidraw scenes and their exported .svg previews. Relative to the project root; ~/ means the home directory.',
};
