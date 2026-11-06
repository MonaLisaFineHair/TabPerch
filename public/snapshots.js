(() => {
  const DATABASE = 'new-tab-page-snapshots';
  const MAX_COUNT = 20;
  const MAX_BYTES = 10 * 1024 * 1024;
  const MAX_AGE = 7 * 86400000;
  let connection;

  function key(value) {
    const url = new URL(value);
    for (const name of [...url.searchParams.keys()]) {
      if (/^utm_/i.test(name) || /^(fbclid|gclid|dclid|msclkid|_ga|_gl|mc_cid|mc_eid)$/i.test(name)) url.searchParams.delete(name);
    }
    url.searchParams.sort();
    if (url.hash && !/^#(?:\/|!)/.test(url.hash)) url.hash = '';
    return url.href;
  }

  function database() {
    if (!connection) connection = new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore('pages', { keyPath: 'key' });
        store.createIndex('capturedAt', 'capturedAt');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => { connection = null; reject(request.error); };
    });
    return connection;
  }

  async function transact(mode, operation) {
    const db = await database();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('pages', mode);
      const request = operation(transaction.objectStore('pages'));
      let result;
      request.onsuccess = () => { result = request.result; };
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('Snapshot storage aborted'));
    });
  }

  async function prune() {
    const db = await database();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('pages', 'readwrite');
      const store = transaction.objectStore('pages');
      const pages = [];
      const request = store.index('capturedAt').openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          pages.push({ key: cursor.primaryKey, capturedAt: cursor.value.capturedAt, bytes: cursor.value.bytes });
          cursor.continue();
          return;
        }
        let count = pages.length;
        let bytes = pages.reduce((total, page) => total + page.bytes, 0);
        for (const page of pages) {
          if (Date.now() - page.capturedAt > MAX_AGE || count > MAX_COUNT || bytes > MAX_BYTES) {
            store.delete(page.key);
            count--;
            bytes -= page.bytes;
          }
        }
      };
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('Snapshot cleanup aborted'));
    });
  }

  globalThis.PageSnapshots = {
    async get(url) {
      const page = await transact('readonly', store => store.get(key(url)));
      if (!page) return null;
      if (Date.now() - page.capturedAt > MAX_AGE) {
        await transact('readwrite', store => store.delete(page.key));
        return null;
      }
      return page;
    },
    async put(page) {
      if (!page.blob || page.blob.size > MAX_BYTES) return;
      await transact('readwrite', store => store.put({ ...page, key: key(page.url), bytes: page.blob.size }));
      await prune();
    },
    clear: () => transact('readwrite', store => store.clear()),
    prune,
  };
})();
