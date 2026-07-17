/**
 * Handler for the ext+container: protocol.
 *
 * The protocol handler fires this page with the full ext+container URI in the
 * hash. We parse it, figure out which container the user wants, and open the
 * tab there.
 */

const PREFIX = 'ext+container:';

function parseParams() {
  const raw = window.location.hash;
  if (!raw || raw.length <= 1) return null;
  let payload = decodeURIComponent(raw.slice(1));
  if (payload.startsWith(PREFIX)) {
    payload = payload.slice(PREFIX.length);
  }
  return new URLSearchParams(payload);
}

function isHttpUrl(url) {
  return url && (url.startsWith('http://') || url.startsWith('https://'));
}

function showError(text) {
  document.getElementById('loading').classList.add('hidden');
  document.getElementById('confirm').classList.add('hidden');
  document.getElementById('error').classList.remove('hidden');
  document.getElementById('errorText').textContent = text;
}

async function closeSelf() {
  try {
    const tab = await browser.tabs.getCurrent();
    if (tab && tab.id >= 0) {
      await browser.tabs.remove(tab.id);
    }
  } catch (err) {
    console.warn('[Company Containers opener] could not close self', err);
  }
}

async function openTab(url, cookieStoreId) {
  // Register a one-shot hint so the background engine doesn't immediately
  // move the new tab somewhere else.
  await browser.runtime.sendMessage({
    type: 'register-hint',
    url,
    cookieStoreId,
    ttlMs: 30000,
  });

  await browser.tabs.create({ url, cookieStoreId, active: true });
  await closeSelf();
}

async function openWithName(params) {
  const url = params.get('url');
  const name = params.get('name');
  const color = params.get('color') || undefined;
  const icon = params.get('icon') || undefined;

  if (!isHttpUrl(url)) {
    showError('The link does not contain a valid http:// or https:// URL.');
    return;
  }

  const existing = await browser.runtime.sendMessage({
    type: 'list-containers',
  }).then((containers) =>
    Object.values(containers || {}).find(
      (c) => c.name.toLowerCase() === name.toLowerCase()
    )
  );

  if (existing) {
    await openTab(url, existing.cookieStoreId);
    return;
  }

  // Ask before creating a brand-new container from an external link.
  document.getElementById('loading').classList.add('hidden');
  document.getElementById('confirm').classList.remove('hidden');
  document.getElementById('confirmName').value = name;
  document.getElementById('confirmUrl').value = url;

  document.getElementById('confirmBtn').onclick = async () => {
    const response = await browser.runtime.sendMessage({
      type: 'ensure-container',
      name,
      color,
      icon,
    });
    await openTab(url, response.container.cookieStoreId);
  };

  document.getElementById('cancelBtn').onclick = closeSelf;
}

function sanitizeColor(color) {
  const allowed = new Set([
    'blue', 'turquoise', 'green', 'yellow', 'orange', 'red', 'pink', 'purple', 'toolbar',
  ]);
  return allowed.has(color) ? color : 'toolbar';
}

function sanitizeIcon(icon) {
  const allowed = new Set([
    'fingerprint', 'briefcase', 'dollar', 'cart', 'circle', 'gift',
    'vacation', 'food', 'fruit', 'pet', 'tree', 'chill', 'fence',
  ]);
  return allowed.has(icon) ? icon : 'circle';
}

async function openWithEngine(url) {
  if (!isHttpUrl(url)) {
    showError('The link does not contain a valid http:// or https:// URL.');
    return;
  }
  // Let the background engine decide the container. It will intercept the
  // new tab's main-frame request and reopen it if needed.
  await browser.tabs.create({ url, active: true });
  await closeSelf();
}

async function main() {
  const params = parseParams();
  if (!params || !params.get('url')) {
    showError('No URL found in the ext+container link.');
    return;
  }

  const url = params.get('url');
  document.getElementById('loadingUrl').textContent = url;

  if (params.get('name')) {
    await openWithName(params);
  } else {
    await openWithEngine(url);
  }
}

main().catch((err) => {
  console.error('[Company Containers opener]', err);
  showError(err.message || String(err));
});
