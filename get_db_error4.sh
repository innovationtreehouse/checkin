#!/bin/bash
export DATABASE_URL="postgresql://testuser:testpassword@localhost:5433/checkmein_test?schema=public"
docker run --name ci_pg -e POSTGRES_USER=testuser -e POSTGRES_PASSWORD=testpassword -e POSTGRES_DB=checkmein_test -p 5433:5432 -d postgres:15
sleep 5
npx prisma db push --accept-data-loss
npm run test:ci
docker stop ci_pg
docker rm ci_pg
