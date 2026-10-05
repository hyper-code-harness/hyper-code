#!/usr/bin/env bash
# Remove Hyper from this machine.
#
#   ./script/uninstall.sh            stop the service and the database container;
#                                    code and data stay (install.sh brings it back)
#   ./script/uninstall.sh --purge    also delete the database volume, the checkout
#                                    and ~/.hyper/docker-compose.yml (asks first;
#                                    add -y to skip the question)
#
# Before --purge a database dump is written to ~/hyper-backup-<date>.sql.gz
# unless --no-backup is given.
#
#   HYPER_DIR  checkout directory   default ~/hyper-code2
set -euo pipefail

HYPER_DIR="${HYPER_DIR:-$HOME/hyper-code2}"
PURGE=0; YES=0; BACKUP=1
for arg in "$@"; do
    case "$arg" in
        --purge) PURGE=1 ;;
        -y|--yes) YES=1 ;;
        --no-backup) BACKUP=0 ;;
        -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
        *) echo "неизвестный аргумент: $arg" >&2; exit 2 ;;
    esac
done

say() { printf '\033[1m==> %s\033[0m\n' "$*"; }
[ -d /Applications/Docker.app/Contents/Resources/bin ] && PATH="$PATH:/Applications/Docker.app/Contents/Resources/bin"
COMPOSE="$HOME/.hyper/docker-compose.yml"
have_docker() { command -v docker >/dev/null && docker info >/dev/null 2>&1; }

if [ "$PURGE" -eq 1 ] && [ "$YES" -ne 1 ]; then
    printf 'Удалить базу Hyper (все агенты и данные) и %s? [y/N] ' "$HYPER_DIR"
    read -r answer < /dev/tty || answer=""
    [[ "$answer" =~ ^[yY] ]] || { echo "отменено"; exit 1; }
fi

say "останавливаю сервис"
if [ "$(uname -s)" = Darwin ]; then
    LABEL="com.niquola.hyper"
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
else
    systemctl --user disable --now hyper.service 2>/dev/null || true
    rm -f "$HOME/.config/systemd/user/hyper.service"
    systemctl --user daemon-reload 2>/dev/null || true
fi
tmux kill-session -t hyper 2>/dev/null || true

if have_docker && docker inspect hyper-db >/dev/null 2>&1; then
    if [ "$PURGE" -eq 1 ] && [ "$BACKUP" -eq 1 ]; then
        dump="$HOME/hyper-backup-$(date +%Y%m%d%H%M%S).sql.gz"
        say "резервная копия базы → $dump"
        docker exec hyper-db pg_dump -U hyper hyper | gzip > "$dump"
    fi
    say "останавливаю базу"
    if [ -f "$COMPOSE" ]; then
        if [ "$PURGE" -eq 1 ]; then docker compose -f "$COMPOSE" down -v; else docker compose -f "$COMPOSE" down; fi
    else
        docker rm -f hyper-db >/dev/null
        [ "$PURGE" -eq 1 ] && docker volume rm hyper_hyper_pgdata >/dev/null 2>&1 || true
    fi
fi

if [ "$PURGE" -eq 1 ]; then
    say "удаляю $HYPER_DIR и $COMPOSE"
    rm -rf "$HYPER_DIR"
    rm -f "$COMPOSE"
    rmdir "$HOME/.hyper" 2>/dev/null || true
fi

say "готово"
