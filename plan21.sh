#!/bin/bash
echo "Wait! I see it! In jest.setup.js:"
cat jest.setup.js | grep -A 5 "jest.mock('next-auth/next'"
