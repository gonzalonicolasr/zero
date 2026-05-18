#!/usr/bin/env bash
#
# deploy-zero.sh — re-deploy the zero SDD site to https://zero.ceroclawd.com
#
# Pushes docs/zero-sdd.html (as index.html), the two comparison pages and the
# assets/ folder to cerostation's /srv/www/zero. DNS, the Cloudflare Tunnel and
# the Caddy block are already configured — this script only refreshes the
# static files.
#
# Usage:
#   bash deploy-zero.sh
#
# Host: defaults to the `minipc` SSH alias. Override it when off-LAN:
#   ZERO_DEPLOY_HOST=minipc-ts bash deploy-zero.sh
#
# No password is stored anywhere. sudo on cerostation prompts you once,
# interactively, over the SSH session — type it when asked.

set -euo pipefail

HOST="${ZERO_DEPLOY_HOST:-minipc}"
REMOTE="/srv/www/zero"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "-> uploading to ${HOST}:/tmp ..."
scp -o ConnectTimeout=10 "${HERE}/zero-sdd.html"         "${HOST}:/tmp/zero-index.html"
scp                      "${HERE}/sdd-vs-gentle.html"    "${HOST}:/tmp/sdd-vs-gentle.html"
scp                      "${HERE}/cortex-vs-engram.html" "${HOST}:/tmp/cortex-vs-engram.html"
scp -r                   "${HERE}/assets"                "${HOST}:/tmp/zero-assets"

echo "-> installing into ${REMOTE} (sudo will ask for your password once) ..."
ssh -t "${HOST}" "sudo sh -c '
  mkdir -p ${REMOTE}/assets &&
  mv /tmp/zero-index.html        ${REMOTE}/index.html &&
  mv /tmp/sdd-vs-gentle.html     ${REMOTE}/sdd-vs-gentle.html &&
  mv /tmp/cortex-vs-engram.html  ${REMOTE}/cortex-vs-engram.html &&
  cp -f /tmp/zero-assets/*       ${REMOTE}/assets/ &&
  rm -rf /tmp/zero-assets &&
  chmod -R a+rX ${REMOTE} &&
  ls -la ${REMOTE}
'"

echo "-> smoke test ..."
curl -s -o /dev/null -w '  zero.ceroclawd.com -> HTTP %{http_code}\n' https://zero.ceroclawd.com/ || true
echo "ok: deploy complete."
