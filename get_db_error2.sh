#!/bin/bash
export DATABASE_URL="postgresql://testuser:testpassword@localhost:5432/checkmein_test"
docker run --name ci_pg -e POSTGRES_USER=testuser -e POSTGRES_PASSWORD=testpassword -e POSTGRES_DB=checkmein_test -p 5432:5432 -d postgres:15
sleep 5
npm run test:ci
docker stop ci_pg
docker rm ci_pg
