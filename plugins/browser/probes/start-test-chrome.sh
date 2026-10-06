#!/bin/sh
# Isolated test Chrome for the live view: CDP on 9230, throwaway profile in /tmp. Never touches 9222/29222.
# Allow it for links: setting browser.liveCdpAllow = http://127.0.0.1:9230
exec tmux new-session -d -s hyper-chrome-9230 "'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' --remote-debugging-port=9230 --user-data-dir=/tmp/hyper-chrome-9230 --no-first-run --no-default-browser-check https://example.com"
