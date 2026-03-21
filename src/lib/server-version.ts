/**
 * Server version — a unique string generated once per server startup.
 * When the server restarts (e.g. after a deploy), a new value is produced,
 * allowing kiosk clients to detect the change and reload.
 */
export const SERVER_VERSION = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
