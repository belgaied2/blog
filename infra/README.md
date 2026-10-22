# Serving infrastructure

Snapshot of the configuration that serves `www.belgai.de`, kept in git so the
blog can be rebuilt on a fresh host without reverse-engineering it.

This is a **backup, not a deployment source**. Nothing here is applied
automatically; the VPS pulls the built site from the `gh-pages` branch, not
from this directory.

## Where it runs

| | |
|---|---|
| Host | `ionos1`, IONOS VPS, Ubuntu 24.04 |
| Public address | `82.165.244.121` |
| Tailscale | `100.79.140.35` |
| Web server | Caddy 2.11, systemd unit `caddy` |
| Document root | `/var/www/blog` |
| Certificates | Let's Encrypt, issued and renewed by Caddy |

## How a post goes live

```
git push master
  └─ GitHub Actions (hugo --minify) → gh-pages branch
       └─ blog-deploy.timer runs every 5 min on ionos1
            └─ git fetch + reset --hard in /var/www/blog
                 └─ Caddy serves /var/www/blog
```

No SSH from CI, no secrets in the runner, no rsync. The only credential is the
VPS's read access to a public repository.

## File map

| In this repo | On the host |
|---|---|
| `infra/caddy/Caddyfile` | `/etc/caddy/Caddyfile` |
| `infra/caddy/conf.d/blog.caddy` | `/etc/caddy/conf.d/blog.caddy` |
| `infra/caddy/conf.d/www.caddy` | `/etc/caddy/conf.d/www.caddy` |
| `infra/systemd/blog-deploy.service` | `/etc/systemd/system/blog-deploy.service` |
| `infra/systemd/blog-deploy.timer` | `/etc/systemd/system/blog-deploy.timer` |

## Restore on a fresh host

```sh
apt install -y caddy git
mkdir -p /var/www
git clone --depth 1 --branch gh-pages https://github.com/belgaied2/blog.git /var/www/blog

install -D -m644 infra/caddy/Caddyfile            /etc/caddy/Caddyfile
install -D -m644 infra/caddy/conf.d/blog.caddy    /etc/caddy/conf.d/blog.caddy
install -D -m644 infra/caddy/conf.d/www.caddy     /etc/caddy/conf.d/www.caddy
install -D -m644 infra/systemd/blog-deploy.service /etc/systemd/system/blog-deploy.service
install -D -m644 infra/systemd/blog-deploy.timer   /etc/systemd/system/blog-deploy.timer

systemctl daemon-reload
systemctl enable --now blog-deploy.timer
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy
```

Then point `www.belgai.de` and `belgai.de` at the new host and let Caddy obtain
certificates. The four other site blocks in `Caddyfile` assume the homelab is
reachable over Tailscale.

## DNS requirements

| Record | Value | Proxy |
|---|---|---|
| `A www` | host public IP | off (grey) |
| `A @` | host public IP | off (grey) |
| `A blog` | host public IP | off (grey) |

Keep the records **DNS only**. Caddy answers the ACME HTTP challenge on port 80
directly; a Cloudflare proxy in front, combined with "Always Use HTTPS", breaks
renewal.

`blog.belgai.de` is a staging mirror with `X-Robots-Tag: noindex` so it cannot
compete with the canonical host.

## Pi-hole caveat

`belgai.de` is configured as a local domain in Pi-hole, so dnsmasq answers
NXDOMAIN for any subdomain without an explicit record instead of forwarding to
Cloudflare. Every hostname needs a local A record. `www`, `belgai.de` and `blog`
are defined; new subdomains are not reachable from the LAN until they are added.

## SSH

Key-only. `/etc/ssh/sshd_config.d/00-hardening.conf` sets:

```
PermitRootLogin prohibit-password
PasswordAuthentication no
KbdInteractiveAuthentication no
```

It sorts before `50-cloud-init.conf`, which cloud-init writes with
`PasswordAuthentication yes` and which sshd would otherwise honour, since sshd
uses the first value it encounters.

## Known issues

- `harbor.belgai.de` reverse-proxies to `192.168.1.199:8083`, a LAN address the
  VPS cannot route. It returns 502 for every visitor. It should use a tailnet
  address like the `nextcloud` block does.
- Public DNS for `nextcloud.belgai.de` and `harbor.belgai.de` points at
  `192.168.1.47`, so those Caddy blocks never receive external traffic.
- The `:80` default site still serves the stock `/usr/share/caddy` placeholder.
