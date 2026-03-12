// Auto-mock for auth-options to prevent ESM import chain in Jest
// (GoogleProvider → openid-client → jose uses ESM exports)
module.exports = {
    authOptions: {}
};
