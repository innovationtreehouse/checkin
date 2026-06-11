// Prisma config for the DEPLOY IMAGE only — the Dockerfile copies this into the
// runner stage as prisma.config.ts (the real prisma.config.ts is not shipped).
// `prisma migrate deploy` runs in the migrate ECS task via an npx-installed CLI,
// so this file must have ZERO imports: `dotenv` and `prisma/config` are not
// resolvable there. A plain default export is fine — the config loader passes it
// through defineConfig itself. DATABASE_URL comes from ECS Secrets Manager
// injection, no dotenv needed.
const config = {
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
};

export default config;
