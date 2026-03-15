#!/bin/bash
echo "Wait, if pubKeys.length === 0 && config.isDev... returns { type: 'kiosk' }"
echo "In test environment, what is config.isDev?"
grep "isDev" src/lib/config.ts
