import { resolve } from 'node:path';
export default {
    type: 'string', default: resolve(process.cwd()), env: 'HYPER_INSTANCE_DATA_ROOT',
    title: 'Instance data root',
    description: 'Absolute local directory shared by all agents in this server instance. Tool result files live under .hyper/results here, independent of agent workspaces and SSH hosts. Back up together with Postgres; changing it does not move existing files.',
};
