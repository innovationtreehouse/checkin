import '@testing-library/jest-dom'

// Note: whatwg-fetch is primarily for browsers. For Node 18+, fetch is native,
// but Jest environments sometimes need explicit global assignments.
if (typeof global.Request === 'undefined') {
    const nodeFetch = require('node-fetch') // Or just use native if available
    global.Request = global.Request || nodeFetch.Request
    global.Response = global.Response || nodeFetch.Response
    global.Headers = global.Headers || nodeFetch.Headers
    global.fetch = global.fetch || nodeFetch
}

const crypto = require('crypto')
if (typeof global.crypto === 'undefined' || !global.crypto.subtle) {
    Object.defineProperty(global, 'crypto', {
        value: crypto.webcrypto,
        writable: true,
    });
}

const { TextEncoder, TextDecoder } = require('util')
global.TextEncoder = TextEncoder
global.TextDecoder = TextDecoder

if (typeof Response !== 'undefined' && !Response.json) {
    Response.json = function (body, init) {
        return new Response(JSON.stringify(body), {
            ...init,
            headers: {
                'content-type': 'application/json',
                ...(init ? init.headers : {})
            }
        });
    }
}
