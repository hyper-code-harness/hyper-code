/** Input to a trusted $gap declaration; all phases share the same clock. */
export type FlowRequest = {now: string; mode: 'preview'} | {now: string; mode: 'explain' | 'apply'; target: {id: string; revision: string}} | {now: string; mode: 'submit'; target: {id:string; revision:string}; action:string; values:Record<string,string>; submissionId:string};
