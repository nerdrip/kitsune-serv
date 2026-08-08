(function () {
  'use strict';

  function ready(callback) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', callback);
    else callback();
  }

  ready(function () {
    var shell = document.querySelector('.ks-shell');
    if (!shell) return;

    var tabs = Array.prototype.slice.call(shell.querySelectorAll('[data-ks-tab]'));
    var panels = Array.prototype.slice.call(shell.querySelectorAll('[data-ks-panel]'));
    function openTab(name) {
      if (!panels.some(function (panel) { return panel.getAttribute('data-ks-panel') === name; })) name = 'overview';
      tabs.forEach(function (tab) { tab.classList.toggle('is-active', tab.getAttribute('data-ks-tab') === name); });
      panels.forEach(function (panel) { panel.classList.toggle('is-active', panel.getAttribute('data-ks-panel') === name); });
      try { sessionStorage.setItem('kitsuneserv-bridge-tab', name); } catch (_) {}
    }
    tabs.forEach(function (tab) { tab.addEventListener('click', function () { openTab(tab.getAttribute('data-ks-tab')); }); });
    try { openTab(sessionStorage.getItem('kitsuneserv-bridge-tab') || 'overview'); } catch (_) { openTab('overview'); }

    var deploymentMode = document.getElementById('ks-deployment-mode');
    var urlMode = document.getElementById('ks-url-mode');
    var proxyMode = document.getElementById('ks-proxy-mode');
    var domain = document.getElementById('ks-panel-domain');
    var hubUrl = document.getElementById('ks-hub-url');
    var managedSections = Array.prototype.slice.call(shell.querySelectorAll('[data-ks-managed-section]'));
    function refreshConfiguration() {
      if (!deploymentMode) return;
      var managed = deploymentMode.value === 'managed';
      managedSections.forEach(function (section) { section.classList.toggle('ks-hidden', !managed); });
      if (!managed && proxyMode) {
        proxyMode.value = 'manual';
        proxyMode.querySelector('option[value="managed"]').disabled = true;
      } else if (proxyMode) {
        proxyMode.querySelector('option[value="managed"]').disabled = false;
      }
      if (hubUrl && urlMode) {
        var automatic = urlMode.value === 'automatic';
        hubUrl.readOnly = automatic;
        if (automatic) hubUrl.value = domain && domain.value ? 'https://' + domain.value : '';
      }
    }
    [deploymentMode, urlMode, domain].forEach(function (element) { if (element) element.addEventListener('change', refreshConfiguration); });
    refreshConfiguration();

    shell.addEventListener('click', function (event) {
      var target = event.target.closest('[data-ks-confirm]');
      if (target && !window.confirm(target.getAttribute('data-ks-confirm'))) event.preventDefault();
    });

    Array.prototype.slice.call(shell.querySelectorAll('[data-ks-copy]')).forEach(function (button) {
      button.addEventListener('click', function () {
        var source = document.getElementById(button.getAttribute('data-ks-copy'));
        if (!source) return;
        var text = source.innerText || source.textContent || '';
        var done = function () {
          var original = button.textContent;
          button.textContent = 'Skopiowano'; button.classList.add('is-copied');
          window.setTimeout(function () { button.textContent = original; button.classList.remove('is-copied'); }, 1600);
        };
        if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done);
        else {
          var area = document.createElement('textarea'); area.value = text; area.style.position = 'fixed'; area.style.opacity = '0'; document.body.appendChild(area); area.select();
          try { document.execCommand('copy'); done(); } finally { document.body.removeChild(area); }
        }
      });
    });

    Array.prototype.slice.call(shell.querySelectorAll('form')).forEach(function (form) {
      form.addEventListener('submit', function (event) {
        if (event.defaultPrevented) return;
        Array.prototype.slice.call(form.querySelectorAll('button[type="submit"],button:not([type])')).forEach(function (button) {
          if (button !== event.submitter) button.disabled = true;
        });
        if (event.submitter) {
          event.submitter.dataset.originalText = event.submitter.textContent;
          event.submitter.textContent = 'Uruchamianie…';
          event.submitter.classList.add('is-loading');
        }
      });
    });
  });
})();
