# Deployment Guide

Deploys the huge-file-transfer-lab backend (Spring Boot) and frontend (React + shadcn)
to the target server: 1 vCPU / 1GB RAM / 25GB disk, Ubuntu 24.04.4 LTS, SSH key auth as
`root` at `159.223.48.162`. See [issue #8](https://github.com/gaturtle/huge-file-transfer-lab/issues/8)
for the architecture decision this guide implements.

Architecture: two containers — the Spring Boot backend, and nginx serving the built
React static assets and reverse-proxying the backend's existing (unprefixed) API routes,
terminating TLS. Images are built by GitHub Actions and pulled from Docker Hub; the
server itself never builds anything.

Throughout, replace:

- `<YOUR_DOMAIN>` — the domain you've pointed at `159.223.48.162`
- `<DOCKERHUB_USER>` — your Docker Hub username/org
- `<YOUR_EMAIL>` — email for Let's Encrypt expiry notices

## 1. Prerequisites

- A domain's `A` record pointed at `159.223.48.162`. Confirm before continuing:
  ```bash
  dig +short <YOUR_DOMAIN>
  # must print 159.223.48.162
  ```
- A Docker Hub account/repo (or org) to push images to.
- Repo layout this guide assumes (created by the backend/frontend implementation tickets):
  ```
  backend/Dockerfile
  frontend/Dockerfile
  deploy/docker-compose.yml
  deploy/nginx.conf
  .github/workflows/build-and-push.yml
  ```

## 2. Server prep

SSH in as root, then:

### 2.1 Install Docker (official apt repo)

```bash
apt-get update
apt-get install -y ca-certificates curl gnupg
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  tee /etc/apt/sources.list.d/docker.list > /dev/null

apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

docker --version
docker compose version
```

### 2.2 Firewall (ufw)

```bash
apt-get install -y ufw
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
ufw status
```

**Caveat**: Docker inserts its own `iptables` rules for published container ports, which
can bypass ufw's filtering. Since this compose file only publishes 80/443 on nginx (the
backend port is never published to the host — nginx reaches it over the compose network),
this doesn't bite us here. If a future change publishes another container port directly,
route it through the `DOCKER-USER` iptables chain instead of relying on ufw alone.

### 2.3 App directories (host bind mounts)

```bash
mkdir -p /srv/huge-file-transfer/{db,staging,completed}
```

- `db/` — SQLite file (Upload Session metadata, issue #4)
- `staging/` — pre-allocated per-session chunk files (issue #4)
- `completed/` — assembled, checksum-verified files (issue #4)

## 3. TLS: certbot on the host

Certbot runs on the host (not in a container) and issues into `/etc/letsencrypt`, which
nginx's container mounts read-only.

```bash
apt-get install -y certbot

# Stop anything on :80 first — standalone mode needs the port free.
docker compose -f /srv/huge-file-transfer/docker-compose.yml down 2>/dev/null || true

certbot certonly --standalone \
  -d <YOUR_DOMAIN> \
  --non-interactive --agree-tos -m <YOUR_EMAIL>
```

This writes `/etc/letsencrypt/live/<YOUR_DOMAIN>/{fullchain.pem,privkey.pem}`.

### Renewal

Certbot installs a systemd timer (`certbot.timer`) automatically on Ubuntu's apt package —
verify it:

```bash
systemctl status certbot.timer
```

Renewal runs `certbot renew`, which reuses standalone mode and needs port 80 free for the
few seconds of the challenge. Add a deploy hook so nginx picks up the renewed cert without
manual intervention:

```bash
mkdir -p /etc/letsencrypt/renewal-hooks/deploy
cat > /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh <<'EOF'
#!/bin/sh
docker compose -f /srv/huge-file-transfer/docker-compose.yml exec -T nginx nginx -s reload
EOF
chmod +x /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
```

## 4. Compose file

`deploy/docker-compose.yml` (copy to `/srv/huge-file-transfer/docker-compose.yml` on the
server):

```yaml
services:
  backend:
    image: <DOCKERHUB_USER>/huge-file-transfer-backend:latest
    restart: unless-stopped
    mem_limit: 700m
    environment:
      - JAVA_TOOL_OPTIONS=-Xmx480m
      - DB_PATH=/data/db/uploads.db
      - STAGING_DIR=/data/staging
      - COMPLETED_DIR=/data/completed
    volumes:
      - /srv/huge-file-transfer/db:/data/db
      - /srv/huge-file-transfer/staging:/data/staging
      - /srv/huge-file-transfer/completed:/data/completed
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"

  nginx:
    image: <DOCKERHUB_USER>/huge-file-transfer-frontend:latest
    restart: unless-stopped
    mem_limit: 50m
    depends_on:
      - backend
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - /etc/letsencrypt:/etc/letsencrypt:ro
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
```

Notes:

- `backend`'s port is **not published** to the host — nginx reaches it over the default
  compose network at `http://backend:8080`, so it's unreachable except through nginx's
  proxy. This is also why the ufw caveat in §2.2 doesn't apply.
- `mem_limit: 700m` on the backend plus nginx's `50m` leaves headroom under the ~850-900MB
  actually available (issue #7: 961Mi total, ~669Mi typically available) for the OS and
  Docker daemon itself. `-Xmx480m` keeps the JVM heap comfortably inside the container's
  cgroup limit, leaving room for off-heap (thread stacks, direct buffers used by chunk
  I/O, metaspace).
- The `huge-file-transfer-frontend` image is nginx with the built React `dist/` baked in
  plus the config below — built by `frontend/Dockerfile` (backend/frontend implementation
  tickets own the actual Dockerfiles).

## 5. nginx config

`deploy/nginx.conf` (baked into the frontend image, or bind-mounted if you'd rather edit
it without rebuilding — bake it in for now, matching the "server never builds" model):

```nginx
server {
    listen 80;
    server_name <YOUR_DOMAIN>;
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }
    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl;
    server_name <YOUR_DOMAIN>;

    ssl_certificate     /etc/letsencrypt/live/<YOUR_DOMAIN>/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/<YOUR_DOMAIN>/privkey.pem;

    # Large file uploads: chunks are 8MiB (issue #3), but disable nginx's body-size
    # limit entirely rather than tune it — the backend, not nginx, is the source of
    # truth for chunk size and rejects anything malformed.
    client_max_body_size 0;

    # Static frontend
    root /usr/share/nginx/html;
    index index.html;
    location / {
        try_files $uri /index.html;
    }

    # Backend API — same-origin, no path rewrite: the frontend already calls the
    # unprefixed routes from issue #3 (/uploads, /uploads/{id}/chunks/{index}, ...),
    # so nginx proxies them straight through instead of stripping an /api prefix.
    location ~ ^/uploads {
        proxy_pass http://backend:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_request_buffering off;
        proxy_read_timeout 300s;
    }
}
```

The plain-HTTP `/.well-known/acme-challenge/` location matters for certbot's *renewal*
(webroot-style requests can arrive over :80 even though initial issuance above used
standalone mode) — keep it even though issuance itself doesn't hit it.

## 6. CI: build and push (GitHub Actions)

`.github/workflows/build-and-push.yml`:

```yaml
name: build-and-push
on:
  push:
    branches: [main]

jobs:
  build-and-push:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: docker/login-action@v3
        with:
          username: ${{ secrets.DOCKERHUB_USERNAME }}
          password: ${{ secrets.DOCKERHUB_TOKEN }}

      - uses: docker/build-push-action@v6
        with:
          context: ./backend
          push: true
          tags: <DOCKERHUB_USER>/huge-file-transfer-backend:latest

      - uses: docker/build-push-action@v6
        with:
          context: ./frontend
          push: true
          tags: <DOCKERHUB_USER>/huge-file-transfer-frontend:latest
```

Requires two repo secrets: `DOCKERHUB_USERNAME` and a `DOCKERHUB_TOKEN` (a Docker Hub
access token, not your account password).

## 7. Initial deploy

Once the backend/frontend implementation tickets have landed `backend/Dockerfile` and
`frontend/Dockerfile`, and a push to `main` has run the workflow above at least once:

```bash
# on the server
cp deploy/docker-compose.yml /srv/huge-file-transfer/docker-compose.yml
cd /srv/huge-file-transfer
docker compose pull
docker compose up -d
docker compose ps
```

Verify:

```bash
curl -I https://<YOUR_DOMAIN>
curl -I https://<YOUR_DOMAIN>/uploads   # expect a 4xx from the backend, not a proxy error
```

## 8. Redeploying after a change

Every merge to `main` rebuilds and re-pushes both `:latest` images via GitHub Actions.
To pick up a new version on the server:

```bash
cd /srv/huge-file-transfer
docker compose pull
docker compose up -d
```

`up -d` only recreates containers whose image actually changed, so this is safe to run
even when only one side (backend or frontend) has a new image.

## 9. Operational notes

- **Restart policy**: `restart: unless-stopped` on both services — they come back after a
  container crash or a full server reboot with no extra tooling (systemd, etc.).
- **Logs**: capped at 10MB × 3 files per container (`json-file` driver options above) so
  a runaway log can't consume the 25GB disk. Inspect with `docker compose logs -f backend`.
- **Disk budget**: `staging/` holds pre-allocated full-size files for in-progress Upload
  Sessions (issue #4) and is bounded by the existing 24h TTL sweep — no additional
  deploy-level disk management needed beyond what issue #4 already decided.
- **Single point of TLS**: nginx is the only TLS terminator; the backend is never
  reachable except through it (§4).
