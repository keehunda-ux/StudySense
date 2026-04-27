/* Injected into every Canvas page. Mounts the sidebar iframe. */

(function () {
  if (document.getElementById('studysense-root')) return;

  const root = document.createElement('div');
  root.id = 'studysense-root';
  root.style.cssText = 'position:fixed;top:0;right:0;width:0;height:0;z-index:999999;pointer-events:none;';

  const iframe = document.createElement('iframe');
  iframe.id = 'studysense-iframe';
  iframe.src = chrome.runtime.getURL('sidebar/sidebar.html');
  iframe.style.cssText = [
    'position:fixed',
    'top:0',
    'right:0',
    'width:360px',
    'height:100vh',
    'border:none',
    'z-index:999999',
    'pointer-events:all',
    'background:transparent',
  ].join(';');
  iframe.setAttribute('allowtransparency', 'true');

  root.appendChild(iframe);
  document.body.appendChild(root);

  chrome.runtime.onMessage.addListener((msg) => {
    try {
      iframe.contentWindow?.postMessage(msg, '*');
    } catch {}
  });
})();
