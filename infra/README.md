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
| Tailscale | `100.79.140.35`, accepts subnet routes (`RouteAll`) |
| Web server | Caddy 2.11, systemd unit `caddy` |
| Document root | `/var/www/blog` |
| Certificates | Let's Encrypt, issued and renewed by Caddy |

LAN addresses are reachable because `optiplex1` advertises `192.168.0.0/23`
and `ionos1` accepts routes. Without a subnet router on the tailnet, the
`nextcloud` and `harbor` blocks below cannot reach their backends.

## Services behind the proxy

| Site | Backend | Notes |
|---|---|---|
| `nextcloud.belgai.de` | `100.116.35.45:8180` | optiplex1 over the tailnet |
| `harbor.belgai.de` | `192.168.1.199:8083` | lenovo-m720-1 over the subnet route |
| `signaling.belgai.de` | `100.116.35.45:8091` | optiplex1 over the tailnet |
| `www` / `belgai.de` | `/var/www/blog` | static Hugo output |
| `blog.belgai.de` | `/var/www/blog` | staging, `noindex` |

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

This also means a `dig` or `nslookup` from inside the LAN does **not** show what
the internet sees: Pi-hole has local A records for `nextcloud.belgai.de` and
`harbor.belgai.de` pointing at `192.168.1.47`, while public DNS points at this
VPS. Check public resolution with `nslookup <name> 1.1.1.1` before concluding a
subdomain is misconfigured.

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

- The `:80` default site still serves the stock `/usr/share/caddy` placeholder.
- Harbor's containers stopped in August after the host disk filled (`No space
  left on device` in `harbor-db`). The stack was restarted in October; the host
  is at 78% disk, so keep an eye on it. To restart:
  `ssh lenovo-m720-1 'cd ~/harbor && sudo docker compose up -d'`
