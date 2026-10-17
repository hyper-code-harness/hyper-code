#!/usr/bin/env bash
# Install (or update) Hyper on a fresh machine with one command:
#
#   curl -fsSL https://raw.githubusercontent.com/hyper-code-harness/hyper-code/main/script/install.sh | bash
#   ./script/install.sh                # from an existing checkout: update and restart
#
# What it does, in order, and each step is safe to repeat:
#   1. checks git and Docker, installs Bun if it is missing;
#   2. clones the repository into $HYPER_DIR (or fast-forwards an existing one);
#   3. bun install;
#   4. starts Postgres (paradedb) from docker-compose.yml as ~/.hyper/docker-compose.yml;
#   5. runs Hyper as a service: launchd on macOS, a systemd user unit on Linux;
#   6. waits until http://127.0.0.1:$PORT/ answers.
#
# Settings (environment):
#   HYPER_DIR    checkout directory           default ~/hyper-code2
#   HYPER_REPO   git URL                      default https://github.com/hyper-code-harness/hyper-code.git
#   HYPER_BRANCH branch                       default main
#   PORT         HTTP port                    default 3010
#
# The LLM provider is not configured here: Claude Code / Codex subscriptions are
# picked up automatically; API keys go to $HYPER_DIR/.env (see README).
set -euo pipefail

HYPER_DIR="${HYPER_DIR:-$HOME/hyper-code2}"
HYPER_REPO="${HYPER_REPO:-https://github.com/hyper-code-harness/hyper-code.git}"
HYPER_BRANCH="${HYPER_BRANCH:-main}"
PORT="${PORT:-3010}"
export PORT

say() { printf '\033[1m==> %s\033[0m\n' "$*"; }
die() { printf 'ошибка: %s\n' "$*" >&2; exit 1; }

OS="$(uname -s)"
[ "$OS" = Darwin ] || [ "$OS" = Linux ] || die "поддерживаются только macOS и Linux"

# Docker Desktop does not always put its CLI on PATH for non-login shells.
[ -d /Applications/Docker.app/Contents/Resources/bin ] && PATH="$PATH:/Applications/Docker.app/Contents/Resources/bin"
export PATH="$HOME/.bun/bin:$PATH"

# 1. prerequisites
say "проверяю git, docker, bun"
command -v git >/dev/null || die "нужен git (macOS: xcode-select --install)"
command -v docker >/dev/null || die "нужен Docker (macOS: https://www.docker.com/products/docker-desktop/)"
docker info >/dev/null 2>&1 || die "Docker установлен, но не запущен — запусти Docker и повтори"
docker compose version >/dev/null 2>&1 || die "нужен docker compose v2"
if ! command -v bun >/dev/null; then
    say "ставлю Bun"
    curl -fsSL https://bun.sh/install | bash
    export PATH="$HOME/.bun/bin:$PATH"
fi
command -v bun >/dev/null || die "bun не найден после установки"

# 2. code
if [ -d "$HYPER_DIR/.git" ]; then
    say "обновляю $HYPER_DIR"
    git -C "$HYPER_DIR" fetch --quiet origin "$HYPER_BRANCH"
    if [ "$(git -C "$HYPER_DIR" rev-parse --abbrev-ref HEAD)" = "$HYPER_BRANCH" ]; then
        git -C "$HYPER_DIR" merge --ff-only --quiet "origin/$HYPER_BRANCH" \
            || echo "  локальные коммиты расходятся с origin/$HYPER_BRANCH — оставляю как есть"
    else
        echo "  checkout не на $HYPER_BRANCH — не трогаю"
    fi
elif [ -e "$HYPER_DIR" ]; then
    die "$HYPER_DIR существует, но это не git checkout"
else
    say "клонирую $HYPER_REPO в $HYPER_DIR"
    git clone --quiet --branch "$HYPER_BRANCH" "$HYPER_REPO" "$HYPER_DIR"
fi
cd "$HYPER_DIR"

# 3. dependencies
say "bun install"
bun install --frozen-lockfile 2>/dev/null || bun install
# Plugins with their own npm dependencies carry their own package.json/bun.lock.
for manifest in plugins/*/package.json; do
    dir="$(dirname "$manifest")"
    grep -q '"dependencies"' "$manifest" || continue
    echo "  $dir"
    (cd "$dir" && { bun install --frozen-lockfile >/dev/null 2>&1 || bun install >/dev/null; })
done

# 4. database — only on 127.0.0.1, with a random password (never the old built-in "hyper": the repo is public).
say "Postgres (paradedb) на 127.0.0.1:54393"
mkdir -p "$HOME/.hyper"
COMPOSE="$HOME/.hyper/docker-compose.yml"
DBENV="$HOME/.hyper/.env"
if [ -f "$COMPOSE" ] && ! cmp -s docker-compose.yml "$COMPOSE"; then
    cp "$COMPOSE" "$COMPOSE.bak-$(date +%Y%m%d%H%M%S)"
fi
# The password: keep the one already generated; otherwise a new one (48 hex).
DB_PW=""
# Missing on first install; existing paths (including dangling symlinks) must be readable.
if [ -e "$DBENV" ] || [ -L "$DBENV" ]; then
    DB_PW="$(sed -n 's/^HYPER_DB_PASSWORD=//p' "$DBENV" | tail -1)"
fi
if [ -z "$DB_PW" ]; then
    DB_PW="$(openssl rand -hex 24)"
    (umask 077; touch "$DBENV"; grep -v '^HYPER_DB_PASSWORD=' "$DBENV" > "$DBENV.new" || true; echo "HYPER_DB_PASSWORD=$DB_PW" >> "$DBENV.new"; mv "$DBENV.new" "$DBENV")
fi
chmod 600 "$DBENV"
# An install from before 14.10 runs with password "hyper" on every interface: rotate it in place (data kept).
if docker inspect hyper-db >/dev/null 2>&1; then
    docker exec hyper-db psql -U hyper -d postgres -qc "ALTER USER hyper PASSWORD '$DB_PW'" \
        || die "не смог сменить пароль базы в hyper-db"
fi
cp docker-compose.yml "$COMPOSE"
mkdir -p "$HOME/.hyper/db-test" && cp script/db-test/*.sql "$HOME/.hyper/db-test/"   # init of the test Postgres (hyper-db-test)
docker compose -f "$COMPOSE" up -d --quiet-pull   # recreates the container on 127.0.0.1 if it was published everywhere
# Hyper reads DATABASE_URL from $HYPER_DIR/.env (0600).
(umask 077; touch .env; grep -v '^DATABASE_URL=' .env > .env.new || true
 echo "DATABASE_URL=postgres://hyper:$DB_PW@127.0.0.1:54393/hyper" >> .env.new; mv .env.new .env)
chmod 600 .env
printf '  жду готовности базы'
for _ in $(seq 1 60); do
    [ "$(docker inspect -f '{{.State.Health.Status}}' hyper-db 2>/dev/null)" = healthy ] && { echo " — готова"; break; }
    printf '.'; sleep 2
done
[ "$(docker inspect -f '{{.State.Health.Status}}' hyper-db 2>/dev/null)" = healthy ] || die "база не поднялась: docker logs hyper-db"

# 5. service
say "запускаю Hyper как сервис (порт $PORT)"
if [ "$OS" = Darwin ]; then
    ./script/install-service.sh
else
    UNIT_DIR="$HOME/.config/systemd/user"
    mkdir -p "$UNIT_DIR" .runtime
    cat > "$UNIT_DIR/hyper.service" <<UNIT
[Unit]
Description=Hyper
After=network-online.target

[Service]
WorkingDirectory=$HYPER_DIR
Environment=PORT=$PORT
Environment=PATH=$HOME/.bun/bin:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=$(command -v bun) script/run-service.ts
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
UNIT
    systemctl --user daemon-reload
    systemctl --user enable --now hyper.service
    systemctl --user restart hyper.service
    command -v loginctl >/dev/null && loginctl enable-linger "$(id -un)" 2>/dev/null || true
fi

# 6. ready?
printf '  жду ответа http://127.0.0.1:%s/' "$PORT"
for _ in $(seq 1 60); do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "http://127.0.0.1:$PORT/" || true)"
    if [[ "$code" =~ ^[1-5][0-9][0-9]$ ]]; then
        echo " — $code"
        say "готово: открой http://localhost:$PORT/"
        exit 0
    fi
    printf '.'; sleep 2
done
echo
die "Hyper не ответил за 2 минуты; логи: $HYPER_DIR/.runtime/server.error.log"
