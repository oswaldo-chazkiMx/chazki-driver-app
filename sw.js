// Service worker mínimo: habilita la instalación como app. Sin caché, para no servir versiones viejas.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
