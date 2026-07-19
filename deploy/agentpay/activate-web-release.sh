#!/usr/bin/env bash
set -euo pipefail

release_id="${1:-$(git rev-parse --short=7 HEAD)}"
build_dir="${AGENTPAY_WEB_BUILD_DIR:-/opt/agentpay/apps/web/dist}"
web_root="${AGENTPAY_WEB_ROOT:-/var/www/agentpay.timidan.xyz}"
releases_dir="$web_root/releases"
release_dir="$releases_dir/$release_id"

if [[ ! "$release_id" =~ ^[0-9a-f]{7,40}$ ]]; then
  echo "release ID must contain 7 to 40 lowercase hexadecimal characters" >&2
  exit 1
fi
if [[ ! -s "$build_dir/index.html" ]]; then
  echo "web build is missing $build_dir/index.html" >&2
  exit 1
fi

install -d -m 0755 "$web_root" "$releases_dir"

if [[ -e "$release_dir" ]]; then
  if [[ ! -d "$release_dir" ]] || ! cmp -s "$build_dir/index.html" "$release_dir/index.html"; then
    echo "release $release_id already exists with different content" >&2
    exit 1
  fi
else
  staging_dir="$(mktemp -d "$releases_dir/.${release_id}.XXXXXX")"
  cleanup() {
    if [[ -n "${staging_dir:-}" && -d "$staging_dir" ]]; then
      rm -rf -- "$staging_dir"
    fi
  }
  trap cleanup EXIT

  cp -a "$build_dir/." "$staging_dir/"
  find "$staging_dir" -type d -exec chmod 0755 {} +
  find "$staging_dir" -type f -exec chmod 0644 {} +
  mv "$staging_dir" "$release_dir"
  staging_dir=""
fi

if [[ "${AGENTPAY_SKIP_NGINX_RELOAD:-0}" != "1" ]]; then
  nginx -t
fi

next_link="$web_root/.current-${release_id}.$$"
ln -s "releases/$release_id" "$next_link"
mv -Tf "$next_link" "$web_root/current"

if [[ "${AGENTPAY_SKIP_NGINX_RELOAD:-0}" != "1" ]]; then
  systemctl reload nginx
fi

printf 'AgentPay web release active: %s\n' "$(readlink -f "$web_root/current")"
