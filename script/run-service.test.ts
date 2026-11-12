import { describe, expect, test } from "bun:test";
import { libpqUrl } from "./run-service";

describe("run-service libpqUrl", () => {
    test("socket ?path= becomes libpq host=<dir> with the port from the socket name", () => {
        expect(libpqUrl("postgres://hyper:pw@localhost/hyper?path=/tmp/.s.PGSQL.54417"))
            .toBe("postgres://hyper:pw@localhost:54417/hyper?host=%2Ftmp");
    });
    test("an explicit port in the URL is kept", () => {
        expect(libpqUrl("postgres://hyper:pw@localhost:54417/hyper?path=/tmp/.s.PGSQL.54417"))
            .toBe("postgres://hyper:pw@localhost:54417/hyper?host=%2Ftmp");
    });
    test("a TCP URL passes through unchanged", () => {
        const url = "postgres://hyper:pw@127.0.0.1:54393/hyper";
        expect(libpqUrl(url)).toBe(url);
    });
    test("the converted URL is accepted by pg_dump's parser", () => {
        const pg = Bun.which("pg_dump"); if (!pg) return;
        // --schema-only against a non-existent socket dir: libpq must fail on CONNECT, not on parsing the URI.
        const r = Bun.spawnSync([pg, "--schema-only", libpqUrl("postgres://u:p@localhost/db?path=/nonexistent-hyper-test/.s.PGSQL.1")], { stderr: "pipe" });
        const err = r.stderr.toString();
        expect(err).not.toContain("invalid URI query parameter");
        expect(err).toContain("/nonexistent-hyper-test/.s.PGSQL.1");
    });
});
