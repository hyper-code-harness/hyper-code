/** Refresh the aggregate preview count every five minutes; initialize on registration. */
export default { fn: 'flow.refreshCount', every: '5m', now: true, args: {force:true} };
