/** Persisted transcript message. Large tool outputs retain their immutable result reference across saves and forks. */
export type Message = {
    role: string;
    content?: string | Array<Record<string, any>> | null;
    idx?: number;
    tool_calls?: Array<{ id: string; name: string; args: any }>;
    tool_call_id?: string;
    message_type?: string;
    excluded_from_llm?: boolean;
    excluded_from_cursor?: boolean;
    author?: string | null;
    /** Reference metadata only; contents are loaded lazily through agent.readResult. */
    result_ref?: types.agent.ResultRef | null;
};
