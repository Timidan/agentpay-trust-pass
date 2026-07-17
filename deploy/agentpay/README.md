# AgentPay Droplet Deployment

AgentPay runs independently from Findling on the same host:

- static web bundle: nginx at `agentpay.timidan.xyz`
- report API: `127.0.0.1:4021`, exposed under `/api/`
- MCP HTTP bridge: `127.0.0.1:3001`, exposed under `/bridge/`
- durable SQLite state: `/var/lib/agentpay/agentpay.sqlite`
- runtime secrets: `/etc/agentpay.env`

Do not put AgentPay keys in Findling's env file or run either AgentPay process as
the Findling service user.

AgentPay requires Node.js 22.13 or newer. The systemd units execute
`/usr/bin/node`, so verify that exact binary before activation; an interactive
`nvm` version does not change what systemd runs.

## One-time host setup

```bash
/usr/bin/node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 22 || (major === 22 && minor < 13)) process.exit(1)'
```

```bash
useradd --system --home /opt/agentpay --shell /usr/sbin/nologin agentpay
install -d -o agentpay -g agentpay -m 0750 /opt/agentpay /var/lib/agentpay
install -o root -g agentpay -m 0640 deploy/agentpay/agentpay.env.example /etc/agentpay.env
install -o root -g root -m 0644 deploy/agentpay/agentpay-report-api.service /etc/systemd/system/
install -o root -g root -m 0644 deploy/agentpay/agentpay-mcp.service /etc/systemd/system/
install -o root -g root -m 0644 deploy/agentpay/nginx.conf /etc/nginx/sites-available/agentpay
ln -s /etc/nginx/sites-available/agentpay /etc/nginx/sites-enabled/agentpay
```

Set these production values in `/etc/agentpay.env` before building or starting:

```dotenv
REPORT_API_HOST=127.0.0.1
REPORT_API_PORT=4021
MCP_SERVER_HOST=127.0.0.1
MCP_SERVER_PORT=3001
AGENTPAY_DATABASE_PATH=/var/lib/agentpay/agentpay.sqlite
AGENTPAY_PUBLIC_ORIGIN=https://agentpay.timidan.xyz
AGENTPAY_ALLOWED_ORIGINS=https://agentpay.timidan.xyz
AGENTPAY_SESSION_COOKIE_PATH=/api/v1
AGENT_PAY_RESOURCE_BASE_URL=https://agentpay.timidan.xyz/api
MCP_ALLOWED_ORIGINS=https://agentpay.timidan.xyz
MCP_SERVER_AUTH_TOKEN=<64-hex-random-value>
MCP_PUBLIC_TESTNET_ASSESSMENTS=1
REPORT_API_URL=http://127.0.0.1:4021
AGENTPAY_DEFAULT_EVIDENCE_NETWORK=casper-mainnet
AGENTPAY_MAINNET_RPC_URL=https://node.mainnet.casper.network/rpc
AGENTPAY_TESTNET_RPC_URL=https://node.testnet.casper.network/rpc
CSPR_TRADE_MCP_URL=https://mcp.cspr.trade/mcp
CSPR_NAME_API_BASE_URL=https://api.cspr.name
X402_NETWORK=casper:casper-test
X402_ASSET_PACKAGE_HASH=<64-hex-Testnet-package-hash>
X402_TOKEN_NAME=<on-chain-token-name>
X402_TOKEN_VERSION=<authorization-domain-version>
X402_TOKEN_DECIMALS=<on-chain-decimals>
X402_TOKEN_SYMBOL=<on-chain-symbol>
PAYEE_ADDRESS=<00-plus-64-hex-recipient>
AGENT_PAY_REPORT_AMOUNT=<price-in-token-base-units>
AGENT_PAY_EXPECTED_PAYEE_ADDRESS=<same-as-PAYEE_ADDRESS>
AGENT_PAY_EXPECTED_X402_ASSET=<same-as-X402_ASSET_PACKAGE_HASH>
AGENT_PAY_EXPECTED_NETWORK=casper:casper-test
AGENT_PAY_MAX_REPORT_AMOUNT=<maximum-base-units-per-public-check>
```

Generate the `MCP_SERVER_AUTH_TOKEN` with `openssl rand -hex 32`. Add the Casper,
x402, registry-recorder, and optional CSPR.cloud values from `.env.example`; keep
all key files root-owned and readable only by the `agentpay` group. Public funded
assessments will refuse to start unless the x402 payment and registry settings
use Casper Testnet. Read-only evidence may come from Mainnet or Testnet and is
identified separately in every quote.

## Build and activate

Run from `/opt/agentpay` after checking out a reviewed commit:

```bash
set -a
. /etc/agentpay.env
set +a
pnpm install --frozen-lockfile
pnpm lint
pnpm test
pnpm build
systemctl daemon-reload
systemctl enable --now agentpay-report-api agentpay-mcp
nginx -t
systemctl reload nginx
certbot --nginx -d agentpay.timidan.xyz
```

The web bundle uses same-origin `/api` and `/bridge` routes by default. Do not set
`VITE_*` URL variables for this nginx deployment. They are build-time overrides
for an intentional split-origin setup, and production builds reject loopback URL
overrides. TLS must terminate at nginx; neither Node service should bind a public
interface.

## Verify

```bash
systemctl is-active agentpay-report-api agentpay-mcp
curl -fsS http://127.0.0.1:4021/health
curl -fsS http://127.0.0.1:3001/health
curl -fsS https://agentpay.timidan.xyz/api/health
curl -fsS https://agentpay.timidan.xyz/bridge/health
curl -fsS 'https://agentpay.timidan.xyz/api/resolve?symbol=WCSPR'
curl -fsS https://agentpay.timidan.xyz/api/skill.md
curl -fsS -X POST https://agentpay.timidan.xyz/bridge/tools/payment_status \
  -H 'content-type: application/json' -d '{}'
pnpm production:check
```

`production:check` fails if the public HTML is stale, a first-party application
bundle or hosted skill exposes a loopback URL, either public service is down,
or the hosted skill does not contain the current payment-auditor tools. It also
resolves WCSPR through the public API, requests a fresh quote, rejects any
loopback value in that payload, and confirms the buy URL uses the public HTTPS
AgentPay origin.

Back up `/var/lib/agentpay/agentpay.sqlite` with SQLite's online backup command
or a stopped-service volume snapshot. Copying only the main file while WAL mode
is active is not a valid backup.
