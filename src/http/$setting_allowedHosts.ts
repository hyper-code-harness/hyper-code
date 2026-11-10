export default {
    type: "json",
    default: ["localhost", "127.0.0.1", "[::1]"],
    title: "Allowed HTTP hosts",
    description: "Exact hostnames allowed when http.checkAllowedHosts is true (opt-in, disabled by default; DNS rebinding is not blocked by default). (without scheme or port; IPv6 in brackets). No wildcards. Add the public DNS name explicitly for remote access and configure listener binding separately. This does not replace authentication. Forwarded hosts must also be listed.",
};
