/** A person who can sign in to this Hyper instance. The password hash never leaves the auth module. */
export type User = {
    /** Stable id written as author on agents, messages and events; never changes on rename. */
    id: string;
    /** Sign-in email; null only while the instance has a single user. */
    email: string | null;
    /** Display name. */
    name: string;
    /** Instance role; owners manage users. */
    role: "owner" | "member";
    /** Whether this user has a password; a lone user without one signs in without a prompt. */
    hasPassword: boolean;
    /** When the name was confirmed at setup; null for a user seeded from env or the legacy password. */
    configuredAt: number | null;
    createdAt: number;
    disabledAt: number | null;
};
