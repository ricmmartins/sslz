/* ========================================
   Startup-Scale Landing Zone — Main JS
   ======================================== */

(function () {
  'use strict';

  /* --- Theme Toggle --- */
  var themeToggle = document.getElementById('theme-toggle');
  var html = document.documentElement;

  function getPreferredTheme() {
    var stored = localStorage.getItem('theme');
    if (stored) return stored;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function setTheme(theme) {
    html.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }

  // Apply theme immediately
  setTheme(getPreferredTheme());

  if (themeToggle) {
    themeToggle.addEventListener('click', function () {
      var current = html.getAttribute('data-theme');
      setTheme(current === 'dark' ? 'light' : 'dark');
    });
  }

  // Listen for system preference changes
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function (e) {
    if (!localStorage.getItem('theme')) {
      setTheme(e.matches ? 'dark' : 'light');
    }
  });

  /* --- Mobile Menu --- */
  var menuToggle = document.getElementById('mobile-menu-toggle');
  var headerNav = document.querySelector('.header-nav');
  var sidebar = document.getElementById('sidebar');

  if (menuToggle) {
    menuToggle.addEventListener('click', function () {
      var isOpen = headerNav.classList.toggle('open');
      if (sidebar) {
        sidebar.classList.toggle('open', isOpen);
      }
      menuToggle.setAttribute('aria-expanded', isOpen);
    });
  }

  // Close mobile menu on outside click
  document.addEventListener('click', function (e) {
    if (menuToggle && headerNav && !menuToggle.contains(e.target) && !headerNav.contains(e.target)) {
      headerNav.classList.remove('open');
      if (sidebar) sidebar.classList.remove('open');
      menuToggle.setAttribute('aria-expanded', 'false');
    }
  });

  /* --- Image Lightbox --- */
  function initLightbox() {
    var overlay = document.createElement('div');
    overlay.className = 'lightbox-overlay';
    overlay.innerHTML = '<img src="" alt="">';
    document.body.appendChild(overlay);

    var overlayImg = overlay.querySelector('img');

    // Add data-zoomable to all images inside .page-content
    document.querySelectorAll('.page-content img').forEach(function (img) {
      img.setAttribute('data-zoomable', '');
    });

    // Attach lightbox click to all data-zoomable images
    document.querySelectorAll('img[data-zoomable]').forEach(function (img) {
      img.addEventListener('click', function () {
        overlayImg.src = img.src;
        overlayImg.alt = img.alt;
        overlay.classList.add('active');
      });
    });

    overlay.addEventListener('click', function () {
      overlay.classList.remove('active');
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') overlay.classList.remove('active');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initLightbox);
  } else {
    initLightbox();
  }

  /* --- Back to Top --- */
  function initBackToTop() {
    var btn = document.querySelector('.back-to-top');
    if (!btn) return;

    window.addEventListener('scroll', function () {
      if (window.scrollY > 600) {
        btn.classList.add('visible');
      } else {
        btn.classList.remove('visible');
      }
    });

    btn.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initBackToTop);
  } else {
    initBackToTop();
  }

  /* --- Mermaid: convert markdown code blocks to mermaid divs --- */
  function convertMermaidBlocks() {
    document.querySelectorAll('pre code.language-mermaid').forEach(function (block) {
      var pre = block.parentElement;
      var div = document.createElement('div');
      div.className = 'mermaid';
      div.textContent = block.textContent;
      pre.parentNode.replaceChild(div, pre);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', convertMermaidBlocks);
  } else {
    convertMermaidBlocks();
  }
})();
