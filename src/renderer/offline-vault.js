'use strict';

(function () {
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('/service-worker.js').catch(() => {});
  const openDb = () => new Promise((resolve, reject) => { const request = indexedDB.open('kitsuneserv-offline', 1); request.onupgradeneeded = () => request.result.createObjectStore('vault'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  const derive = async (passphrase, salt, usage) => { const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']); return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 310000, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, usage); };
  const transact = async (mode, operation) => { const db = await openDb(); return new Promise((resolve, reject) => { const transaction = db.transaction('vault', mode); const request = operation(transaction.objectStore('vault')); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); transaction.oncomplete = () => db.close(); }); };
  window.kitsuneOfflineVault = {
    save: async (name, payload, passphrase) => { if (String(passphrase).length < 12) throw new Error('Offline Vault passphrase requires at least 12 characters'); const salt = crypto.getRandomValues(new Uint8Array(16)); const iv = crypto.getRandomValues(new Uint8Array(12)); const key = await derive(passphrase, salt, ['encrypt']); const plaintext = new TextEncoder().encode(JSON.stringify({ schemaVersion: 1, savedAt: new Date().toISOString(), payload })); const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext); await transact('readwrite', store => store.put({ salt: [...salt], iv: [...iv], ciphertext: [...new Uint8Array(ciphertext)] }, String(name))); return { success: true, encrypted: true }; },
    load: async (name, passphrase) => { const record = await transact('readonly', store => store.get(String(name))); if (!record) throw new Error('Offline bundle not found'); const key = await derive(passphrase, new Uint8Array(record.salt), ['decrypt']); const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(record.iv) }, key, new Uint8Array(record.ciphertext)); return JSON.parse(new TextDecoder().decode(plaintext)).payload; },
    remove: async name => { await transact('readwrite', store => store.delete(String(name))); return { success: true }; }
  };
})();
