# AWS Setup — CheckMeIn

## Architecture Decision

**Bare metal** on EC2 — Node.js, PostgreSQL, and Caddy installed directly on the instance. Chosen over Docker Compose because:
- `t3.small` (2GB RAM / 8GB disk) is too constrained for Docker builds
- On a single EC2, container isolation provides negligible security benefit — the app has the DB connection string regardless
- Real DB isolation comes from using a separate DB server (e.g., RDS), not containers on the same host
- Bare metal uses less disk (~200MB vs ~2GB for Docker images) and less RAM

Docker files (`Dockerfile`, `docker-compose.prod.yml`) are kept in the repo for future CI/CD or migration to ECS.

## Environments

| Environment | Elastic IP | Domain (nip.io) | Instance Type |
|-------------|-----------|------------------|---------------|
| **Dev** | `3.17.46.175` | `3-17-46-175.nip.io` | `t3.small` |
| **Prod** | `3.147.146.220` | `3-147-146-220.nip.io` | `t3.small` |

Both run Ubuntu 24.04 LTS. nip.io provides free DNS that resolves based on the embedded IP. When a real domain is ready, update the Caddyfile and `NEXTAUTH_URL`.

## SSH Access

```bash
ssh -i /path/to/daniel_isntances.pem ubuntu@3.17.46.175    # dev
ssh -i /path/to/daniel_isntances.pem ubuntu@3.147.146.220   # prod
```

---

## Instance Setup (one-time per EC2)

Run all of the following as the `ubuntu` user after SSH'ing in.

### 1. System updates + swap

```bash
sudo apt update && sudo apt upgrade -y

# Add 2GB swap (prevents OOM during npm ci --include=dev / next build)
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### 2. Install Node.js 20

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node --version  # should be 20.x
```

### 3. Install PostgreSQL 15

```bash
sudo apt install -y postgresql postgresql-contrib
sudo systemctl enable postgresql
sudo systemctl start postgresql
```

Create the database and user:

```bash
sudo -u postgres psql << 'SQL'
CREATE USER checkmein WITH PASSWORD 'CHANGE_ME_STRONG_PASSWORD';
CREATE DATABASE checkmein OWNER checkmein;
GRANT ALL PRIVILEGES ON DATABASE checkmein TO checkmein;
SQL
```

> Replace `CHANGE_ME_STRONG_PASSWORD` with the same password you use in `DATABASE_URL`.

### 4. Install Caddy

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install -y caddy
```

### 5. Configure Caddy

The repo ships a `Caddyfile` that serves Next.js static assets directly (required because standalone mode doesn't serve `_next/static/`). Copy it to Caddy's config directory:

```bash
sudo cp ~/checkmein/Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

> **Per-environment**: The domain is hardcoded in the Caddyfile. For prod, edit the domain line before copying.

**One-time**: Allow the `caddy` user to traverse into the project directory to serve static files:

```bash
chmod o+x /home/ubuntu /home/ubuntu/checkmein /home/ubuntu/checkmein/.next
```

Caddy automatically provisions a Let's Encrypt TLS certificate. HTTP requests are auto-redirected to HTTPS.

### 6. Clone the repo and install dependencies

```bash
git clone https://github.com/dkaygithub/checkmein.git ~/checkmein
cd ~/checkmein
npm ci --include=dev
```

### 7. Create the `.env`

```bash
cat > ~/checkmein/.env << 'EOF'
DATABASE_URL=postgresql://checkmein:CHANGE_ME_STRONG_PASSWORD@localhost:5432/checkmein?schema=public
GOOGLE_CLIENT_ID=<YOUR_GOOGLE_CLIENT_ID>
GOOGLE_CLIENT_SECRET=<YOUR_GOOGLE_CLIENT_SECRET>
NEXTAUTH_URL=https://3-17-46-175.nip.io
NEXTAUTH_SECRET=CHANGE_ME_RUN_openssl_rand_base64_32
NEXT_PUBLIC_DEV_AUTH=true
BOOTSTRAP_SYSADMINS=<COMMA_SEPARATED_ADMIN_EMAILS>
EOF
```

> **Prod note**: Do NOT set `NEXT_PUBLIC_DEV_AUTH` on the prod instance.

### 8. Build and set up the database

```bash
cd ~/checkmein
npx prisma generate
npx prisma db push
npx ts-node --compiler-options '{"module":"CommonJS"}' prisma/seed.ts
npm run build

# Caddy runs as the 'caddy' user and needs read access to serve static files
chmod -R o+rX .next/static
```

### 9. Create a systemd service

This ensures the app starts on boot and restarts on crash:

```bash
sudo tee /etc/systemd/system/checkmein.service << 'EOF'
[Unit]
Description=CheckMeIn Next.js App
After=network.target postgresql.service

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/checkmein
ExecStart=/usr/bin/node /home/ubuntu/checkmein/.next/standalone/server.js
Restart=on-failure
RestartSec=5
EnvironmentFile=/home/ubuntu/checkmein/.env
Environment=NODE_ENV=production PORT=4000

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable checkmein
sudo systemctl start checkmein
```

### 10. Verify

```bash
# Check the service is running
sudo systemctl status checkmein

# Test the health endpoint
curl http://localhost:4000/api/health
# Should return: {"status":"ok"}

# Test HTTPS via Caddy
curl https://3-17-46-175.nip.io/api/health
# Should return: {"status":"ok"}
```

---

## Google OAuth

Add these authorized redirect URIs in the [Google Cloud Console](https://console.cloud.google.com/apis/credentials):

- Dev: `https://3-17-46-175.nip.io/api/auth/callback/google`
- Prod: `https://3-147-146-220.nip.io/api/auth/callback/google`

---

## Common Operations

### Deploy an update
```bash
cd ~/checkmein
git pull
npm ci --include=dev
npx prisma generate
npx prisma db push
npm run build

# Caddy needs read access to serve static files
chmod -R o+rX .next/static

# Update Caddy config if Caddyfile changed
sudo cp ~/checkmein/Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy

sudo systemctl restart checkmein
```

### View logs
```bash
sudo journalctl -u checkmein -f
```

### Restart
```bash
sudo systemctl restart checkmein
```

### Check status
```bash
sudo systemctl status checkmein
```

### Check Caddy / TLS
```bash
sudo systemctl status caddy
sudo journalctl -u caddy -f
```

---

## Security

- PostgreSQL listens on **localhost only** (default) — not exposed to the internet
- Security group allows inbound TCP 22 (SSH), 80 (HTTP→HTTPS redirect), 443 (HTTPS) only
- Caddy enforces HTTPS everywhere with auto-renewed Let's Encrypt certs
- `NEXT_PUBLIC_DEV_AUTH` enables dev login picker — **only set on dev, never on prod**
- `CredentialsProvider` (mock auth backend) activates only when `NEXT_PUBLIC_DEV_AUTH` is set
- `BOOTSTRAP_SYSADMINS` auto-promotes listed emails to sysadmin on login

## Cost

~$15–20/mo per instance:
- `t3.small` (2 vCPU / 2 GB): ~$15/mo
- 8 GB EBS gp3: ~$0.64/mo
- Elastic IP: free while attached

## Future Improvements

- [ ] GitHub Actions CI/CD (auto-deploy to dev, manual promote to prod)
- [ ] Real domain name (replacing nip.io)
- [ ] Production Google OAuth credentials
- [ ] Automated EBS snapshots for backups
- [ ] Monitoring / alerting
- [ ] Migrate DB to RDS for true network isolation (when budget allows)
