export default {
    type: 'json',
    env: 'SKILLS_ROOTS',
    default: ['~/.agents/skills', '~/.claude/skills', '~/.codex/skills'],
    title: 'Shared skill folders',
    description: 'Folders of standard Agent Skills (<name>/SKILL.md) on this machine that are read in place, without copying: the cross-client ~/.agents/skills and the Claude Code and Codex folders. Hyper never writes there. As an environment variable: paths separated by a colon; empty turns the folders off.',
};
