# CheckMeIn — macOS Local Setup Guide

This guide walks you through setting up and running CheckMeIn on a Mac (Intel or Apple Silicon).

---

## Prerequisites

| Tool | Minimum Version | Install |
|------|----------------|---------|
| **Node.js** | 20.x | `brew install node@20` |
| **npm** | 10.x | Comes with Node.js |
| **Docker Desktop** | Latest | [Download](https://www.docker.com/products/docker-desktop/) |
| **Git** | 2.x | `brew install git` (or Xcode CLI tools) |

> [!TIP]
> If you use **nvm**, run `nvm install 20 && nvm use 20`.

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

Make sure Docker Desktop is running, then:

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

```bash
cp .env.example .env   # if an example exists, otherwise create manually
```

Add the following values:

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

### Prisma client not generated
If you see errors about missing Prisma client, re-run:
```bash
npx prisma generate
```

### Docker Desktop not running
If `docker compose up` fails, make sure Docker Desktop is open and running.

### Apple Silicon (M1/M2/M3)
The PostgreSQL 15 Docker image supports ARM64 natively — no extra configuration needed.

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
