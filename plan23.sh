#!/bin/bash
echo "Wait, if the test is setting getServerSession mock correctly, why is it failing with 403?"
echo "Let's check the code of the endpoint..."
cat src/app/api/admin/roles/route.ts
