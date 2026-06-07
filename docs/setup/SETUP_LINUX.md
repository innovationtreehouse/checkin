# CheckMeIn — Linux Local Setup Guide

This guide walks you through setting up and running CheckMeIn on a Linux machine (Ubuntu/Debian, Fedora, or Arch-based distros).

---

## Prerequisites

| Tool | Minimum Version | Install |
|------|----------------|---------|
| **Node.js** | 20.x | See below |
| **npm** | 10.x | Comes with Node.js |
| **Docker + Docker Compose** | Latest | See below |
| **Git** | 2.x | Package manager |

### Install Node.js 20

**Ubuntu / Debian:**
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

**Fedora:**
```bash
sudo dnf install -y nodejs
```

**Arch:**
```bash
sudo pacman -S nodejs npm
```

> [!TIP]
> Alternatively, use **nvm** for version management: `nvm install 20 && nvm use 20`

### Install Docker

**Ubuntu / Debian:**
```bash
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker $USER
```
Log out and back in for the group change to take effect.

**Fedora:**
```bash
sudo dnf install -y docker docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker $USER
```

**Arch:**
```bash
sudo pacman -S docker docker-compose
sudo systemctl enable --now docker
sudo usermod -aG docker $USER
```

---

## 1. Clone the Repository

```bash
git clone git@github.com:dkaygithub/checkmein.git
cd checkmein
```

---

## 2. Install Dependencies

```bash
npm install
```

---

## 3. Start PostgreSQL (Docker)

```bash
docker compose up -d db
```

This starts a PostgreSQL 15 container on **port 5433** (mapped from container port 5432).

Verify it's running:

```bash
docker compose ps
```

---

## 4. Configure Environment Variables

Create a `.env` file in the project root:

```env
DATABASE_URL="postgresql://prisma:prismapassword@localhost:5433/checkmein?schema=public"

# Google OAuth (create credentials at https://console.cloud.google.com/apis/credentials)
GOOGLE_CLIENT_ID="your-google-client-id"
GOOGLE_CLIENT_SECRET="your-google-client-secret"

# NextAuth
NEXTAUTH_URL="http://localhost:4000"
NEXTAUTH_SECRET="any-random-secret-string"
```

> [!IMPORTANT]
> Generate a `NEXTAUTH_SECRET` with: `openssl rand -base64 32`

---

## 5. Set Up the Database

Generate the Prisma client and apply migrations:

```bash
npx prisma generate
npx prisma db push
```

Seed the database with default users:

```bash
npx ts-node --compiler-options '{"module":"CommonJS"}' prisma/seed.ts
```

This creates two test users:
- `keyholder@example.com` — Keyholder + Sysadmin
- `member@example.com` — Standard participant

---

## 6. Run the Dev Server

```bash
npm run dev
```

The app will be available at **http://localhost:4000**.

---

## Common Issues

### Port 5433 already in use
If you have a local PostgreSQL installation using port 5433, either stop it or update the port mapping in `docker-compose.yml`.

```bash
# Check what's using the port
sudo lsof -i :5433
```

### Prisma client not generated
If you see errors about missing Prisma client, re-run:
```bash
npx prisma generate
```

### Docker permission denied
If you get `permission denied` errors from Docker, make sure you've added yourself to the `docker` group and logged out/in:
```bash
sudo usermod -aG docker $USER
# Then log out and back in
```

### OpenSSL errors with Prisma
If Prisma fails with OpenSSL errors, install the required library:

**Ubuntu / Debian:**
```bash
sudo apt-get install -y libssl-dev
```

**Fedora:**
```bash
sudo dnf install -y openssl-devel
```

Then re-run `npx prisma generate`.

---

## Stopping the App

```bash
# Stop the dev server
Ctrl+C

# Stop the database container
docker compose down

# Stop and remove all data (fresh start)
docker compose down -v
```
