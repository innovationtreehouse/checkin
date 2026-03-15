#!/bin/bash
echo "So, if it returns { type: 'kiosk' } and !options.allowKiosk, it returns 403 Forbidden."
echo "If test does not set 'cookie' header, it matches !req.headers.get('cookie')."
echo "Why did it suddenly start returning 403 instead of successfully working with mocked getServerSession?"
echo "Because previously we didn't mock 'cross-fetch' Request differently?"
