import '@testing-library/jest-dom'
import 'whatwg-fetch'

const crypto = require('crypto')
if (typeof global.crypto === 'undefined' || !global.crypto.subtle) {
    Object.defineProperty(global, 'crypto', {
        value: crypto.webcrypto,
        writable: true,
    });
}

import { TextEncoder, TextDecoder } from 'util'
global.TextEncoder = TextEncoder
global.TextDecoder = TextDecoder

if (typeof Response !== 'undefined' && !Response.json) {
    Response.json = function (body, init) {
        const response = new Response(JSON.stringify(body), {
            ...init,
            headers: {
                'content-type': 'application/json',
                ...(init ? init.headers : {})
            }
        });
        return response;
    }
}
