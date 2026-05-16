# CheckMeIn

A member check-in and program management system built with Next.js, Prisma, and PostgreSQL.

## Repository layout

- **`/`** — Next.js + Prisma backend (this README's "Local Setup" applies here)
- **`client/`** — Python kiosk client that runs on Raspberry Pi devices at the facility entrance. See [`client/README.md`](client/README.md).

## Local Setup

Follow the guide for your operating system:

- **[macOS Setup Guide](SETUP_MACOS.md)** — Install and run on a MacBook (Intel or Apple Silicon)
- **[Linux Setup Guide](SETUP_LINUX.md)** — Install and run on Ubuntu/Debian, Fedora, or Arch

## Quick Start (if prerequisites are already installed)

```bash
npm install
docker compose up -d db
npx prisma generate
npx prisma db push
npx ts-node --compiler-options '{"module":"CommonJS"}' prisma/seed.ts
npm run dev
```

The app runs at **http://localhost:4000**.
