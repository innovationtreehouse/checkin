const crypto = require('crypto');
const assert = require('assert');

// Simulate the webhook verification logic
function verify(rawBody, secret, headerSignature) {
    const generatedSignature = crypto
        .createHmac("sha256", secret)
        .update(rawBody, "utf8")
        .digest("base64");

    const generatedBuffer = crypto.createHash('sha256').update(generatedSignature).digest();
    const headerBuffer = crypto.createHash('sha256').update(headerSignature).digest();

    return crypto.timingSafeEqual(generatedBuffer, headerBuffer);
}

const rawBody = '{"test": true}';
const secret = 'my_secret_key';

// Calculate expected signature
const expectedSignature = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");

// Test 1: Valid signature
assert.strictEqual(verify(rawBody, secret, expectedSignature), true);
console.log('Test 1 passed: Valid signature');

// Test 2: Invalid signature of same length
const invalidSignature1 = 'A' + expectedSignature.substring(1);
assert.strictEqual(verify(rawBody, secret, invalidSignature1), false);
console.log('Test 2 passed: Invalid signature (same length)');

// Test 3: Invalid signature of different length
const invalidSignature2 = expectedSignature + 'A';
assert.strictEqual(verify(rawBody, secret, invalidSignature2), false);
console.log('Test 3 passed: Invalid signature (different length)');

console.log('All tests passed!');
