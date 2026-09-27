/** The brooksgroves.com chrome, so HopLove reads as part of the site rather
 *  than a stranger living at /hoplore/: the same topline, masthead bar, theme
 *  toggle (sharing the site's `bg_theme` key, so a dark-mode choice follows you
 *  in from the homepage and back) and the same footer.
 *
 *  The footer markup is copied from bdgroves.github.io (tags.html) with links
 *  made absolute, and styled by that site's own /css/site-footer.css, which
 *  this page links -- so a footer change there shows up here on the next
 *  deploy without touching this repo, as long as the markup stays the same. */

export const SITE = 'https://brooksgroves.com';

export const FONTS =
  'https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;0,900;1,400;1,600&family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=DM+Mono:wght@300;400;500&display=swap';

/** Runs before first paint so there's no light flash in dark mode. */
export const THEME_INIT = `<script>
  (function(){
    try {
      var saved = localStorage.getItem('bg_theme');
      var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      if (saved === 'dark' || (!saved && prefersDark)) document.documentElement.setAttribute('data-theme','dark');
    } catch(e) {}
  })();
</script>`;

export const siteHeader = (base) => `<div class="topline"></div>
<header class="sitebar">
  <div class="sitebar-inner">
    <a href="${SITE}/" class="site-name">Brooks Groves</a>
    <nav class="sitebar-nav" aria-label="brooksgroves.com">
      <a href="${base}">HopLove</a>
      <a href="${SITE}/#work">Projects</a>
      <a href="${SITE}/">Home</a>
      <button id="theme-toggle" class="theme-toggle" aria-label="Switch to dark mode" title="Switch to dark mode">&#9681;</button>
    </nav>
  </div>
</header>`;

export const THEME_TOGGLE = `<script>
(function(){
  var root = document.documentElement, btn = document.getElementById('theme-toggle');
  if (!btn) return;
  function sync() {
    var dark = root.getAttribute('data-theme') === 'dark';
    btn.textContent = dark ? '\u25D0' : '\u25D1';
    var label = dark ? 'Switch to light mode' : 'Switch to dark mode';
    btn.setAttribute('aria-label', label); btn.setAttribute('title', label);
  }
  sync();
  btn.addEventListener('click', function() {
    var dark = root.getAttribute('data-theme') === 'dark';
    if (dark) root.removeAttribute('data-theme'); else root.setAttribute('data-theme','dark');
    try { localStorage.setItem('bg_theme', dark ? 'light' : 'dark'); } catch(e) {}
    sync();
  });
})();
</script>`;

export const SITE_FOOTER = `<footer>
  <div class="footer-inner">
    <div>
      <p class="footer-name">Brooks Groves</p>
      <p class="footer-tagline">&#127794; Made in the Pacific Northwest &middot; &#10084;&#65039; Born in <a href="https://en.wikipedia.org/wiki/Tuolumne_County,_California" target="_blank" rel="noopener">Tuolumne County, CA</a></p>
    </div>

    <div class="footer-connect">
      <div class="fc-label">Connect</div>
      <div class="social-row">
          <a class="social-btn" href="mailto:contact@brooksgroves.com" aria-label="Email" title="Email"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M1.5 4.5h21v15h-21v-15Zm1.8 1.8v.4L12 12.9l8.7-6.2v-.4H3.3Zm0 2.6v9.1h17.4V8.9L12 15.1 3.3 8.9Z"/></svg></a>
          <a class="social-btn" href="https://github.com/bdgroves" target="_blank" rel="noopener" aria-label="GitHub" title="GitHub"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg></a>
          <a class="social-btn" href="https://x.com/bdgroves" target="_blank" rel="noopener" aria-label="X" title="X"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M14.234 10.162 22.977 0h-2.072l-7.591 8.824L7.251 0H.258l9.168 13.343L.258 24H2.33l8.016-9.318L16.749 24h6.993zm-2.837 3.299-.929-1.329L3.076 1.56h3.182l5.965 8.532.929 1.329 7.754 11.09h-3.182z"/></svg></a>
          <a class="social-btn" href="https://www.linkedin.com/in/brooks-groves-gisp-137219139/" target="_blank" rel="noopener" aria-label="LinkedIn" title="LinkedIn"><span class="social-word" aria-hidden="true">in</span></a>
          <a class="social-btn" href="https://bsky.app/profile/bdgroves.bsky.social" target="_blank" rel="noopener" aria-label="Bluesky" title="Bluesky"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5.202 2.857C7.954 4.922 10.913 9.11 12 11.358c1.087-2.247 4.046-6.436 6.798-8.501C20.783 1.366 24 .213 24 3.883c0 .732-.42 6.156-.667 7.037-.856 3.061-3.978 3.842-6.755 3.37 4.854.826 6.089 3.562 3.422 6.299-5.065 5.196-7.28-1.304-7.847-2.97-.104-.305-.152-.448-.153-.327 0-.121-.05.022-.153.327-.568 1.666-2.782 8.166-7.847 2.97-2.667-2.737-1.432-5.473 3.422-6.3-2.777.473-5.899-.308-6.755-3.369C.42 10.04 0 4.615 0 3.883c0-3.67 3.217-2.517 5.202-1.026"/></svg></a>
          <a class="social-btn" href="https://www.strava.com/athletes/59148" target="_blank" rel="noopener" aria-label="Strava" title="Strava"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169"/></svg></a>
          <a class="social-btn" href="https://untappd.com/user/bdgroves" target="_blank" rel="noopener" aria-label="Untappd" title="Untappd"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M11 13.299l-5.824 8.133c-.298.416-.8.635-1.308.572-.578-.072-1.374-.289-2.195-.879S.392 19.849.139 19.323a1.402 1.402 0 0 1 .122-1.425l5.824-8.133a3.066 3.066 0 0 1 1.062-.927l1.146-.604c.23-.121.436-.283.608-.478.556-.631 2.049-2.284 4.696-4.957l.046-.212a.134.134 0 0 1 .096-.1l.146-.037a.135.135 0 0 0 .101-.141l-.015-.18a.13.13 0 0 1 .125-.142c.176-.005.518.046 1.001.393s.64.656.692.824a.13.13 0 0 1-.095.164l-.175.044a.133.133 0 0 0-.101.141l.012.15a.131.131 0 0 1-.063.123l-.186.112c-1.679 3.369-2.764 5.316-3.183 6.046a2.157 2.157 0 0 0-.257.73l-.205 1.281A3.074 3.074 0 0 1 11 13.3zm12.739 4.598l-5.824-8.133a3.066 3.066 0 0 0-1.062-.927l-1.146-.605a2.138 2.138 0 0 1-.608-.478 50.504 50.504 0 0 0-.587-.654.089.089 0 0 0-.142.018 97.261 97.261 0 0 1-1.745 3.223 1.42 1.42 0 0 0-.171.485 3.518 3.518 0 0 0 0 1.103l.01.064c.075.471.259.918.536 1.305l5.824 8.133c.296.413.79.635 1.294.574a4.759 4.759 0 0 0 2.209-.881 4.762 4.762 0 0 0 1.533-1.802 1.4 1.4 0 0 0-.122-1.425zM8.306 3.366l.175.044a.134.134 0 0 1 .101.141l-.012.15a.13.13 0 0 0 .063.123l.186.112c.311.623.599 1.194.869 1.721.026.051.091.06.129.019.437-.469.964-1.025 1.585-1.668a.137.137 0 0 0 .003-.19c-.315-.322-.645-.659-1.002-1.02l-.046-.212a.13.13 0 0 0-.096-.099l-.146-.037a.135.135 0 0 1-.101-.141l.015-.18a.13.13 0 0 0-.123-.142c-.175-.005-.518.045-1.002.393-.483.347-.64.656-.692.824a.13.13 0 0 0 .095.164z"/></svg></a>
          <a class="social-btn" href="https://www.goodreads.com/user/show/9579797" target="_blank" rel="noopener" aria-label="Goodreads" title="Goodreads"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M17.346.026c.422-.083.859.037 1.179.325.346.284.55.705.557 1.153-.023.457-.247.88-.612 1.156l-2.182 1.748a.601.601 0 0 0-.255.43.52.52 0 0 0 .11.424 5.886 5.886 0 0 1 .832 6.58c-1.394 2.79-4.503 3.99-7.501 2.927a.792.792 0 0 0-.499-.01c-.224.07-.303.18-.453.383l-.014.02-.941 1.254s-.792.985.457.935c3.027-.119 3.817-.119 5.439-.01 2.641.18 3.806 1.903 3.806 3.275 0 1.623-1.036 3.383-3.809 3.383a117.46 117.46 0 0 0-5.517-.03c-.31.005-.597.013-.835.02-.228.006-.41.011-.52.011-.712 0-1.648-.186-1.66-1.068-.008-.729.624-1.12 1.11-1.172.43-.045.815.007 1.24.064.252.034.518.07.815.088.185.011.366.025.552.038.53.038 1.102.08 1.926.087.427.005.759.01 1.025.015.695.012.941.016 1.28-.015 1.248-.112 1.832-.61 1.832-1.376 0-.805-.584-1.264-1.698-1.414-1.564-.213-2.33-.163-3.72-.074a87.66 87.66 0 0 1-1.669.095c-.608.029-2.449.026-2.682-1.492-.053-.416-.073-1.116.807-2.325l.75-1.003c.36-.49.582-.898.053-1.559 0 0-.39-.468-.52-.638-1.215-1.587-1.512-4.08-.448-6.114 1.577-3.011 5.4-4.26 8.37-2.581.253.143.438.203.655.163.201-.032.27-.167.363-.344.02-.04.042-.082.067-.126.004-.01.241-.465.535-1.028l.734-1.41a1.493 1.493 0 0 1 1.041-.785ZM9.193 13.243c1.854.903 3.912.208 5.254-2.47 1.352-2.699.827-5.11-1.041-6.023C10.918 3.537 8.81 5.831 8.017 7.41c-1.355 2.698-.717 4.886 1.147 5.818Z"/></svg></a>
          <a class="social-btn" href="https://ko-fi.com/brooksgroves" target="_blank" rel="noopener" aria-label="Tip Jar" title="Tip Jar"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M11.351 2.715c-2.7 0-4.986.025-6.83.26C2.078 3.285 0 5.154 0 8.61c0 3.506.182 6.13 1.585 8.493 1.584 2.701 4.233 4.182 7.662 4.182h.83c4.209 0 6.494-2.234 7.637-4a9.5 9.5 0 0 0 1.091-2.338C21.792 14.688 24 12.22 24 9.208v-.415c0-3.247-2.13-5.507-5.792-5.87-1.558-.156-2.65-.208-6.857-.208m0 1.947c4.208 0 5.09.052 6.571.182 2.624.311 4.13 1.584 4.13 4v.39c0 2.156-1.792 3.844-3.87 3.844h-.935l-.156.649c-.208 1.013-.597 1.818-1.039 2.546-.909 1.428-2.545 3.064-5.922 3.064h-.805c-2.571 0-4.831-.883-6.078-3.195-1.09-2-1.298-4.155-1.298-7.506 0-2.181.857-3.402 3.012-3.714 1.533-.233 3.559-.26 6.39-.26m6.547 2.287c-.416 0-.65.234-.65.546v2.935c0 .311.234.545.65.545 1.324 0 2.051-.754 2.051-2s-.727-2.026-2.052-2.026m-10.39.182c-1.818 0-3.013 1.48-3.013 3.142 0 1.533.858 2.857 1.949 3.897.727.701 1.87 1.429 2.649 1.896a1.47 1.47 0 0 0 1.507 0c.78-.467 1.922-1.195 2.623-1.896 1.117-1.039 1.974-2.364 1.974-3.897 0-1.662-1.247-3.142-3.039-3.142-1.065 0-1.792.545-2.338 1.298-.493-.753-1.246-1.298-2.312-1.298"/></svg></a>
      </div>
    </div>

    <div class="footer-pagelinks">
      <div class="fc-label">More here</div>
      <div class="pagelink-row">
        <a href="https://brooksgroves.com/writing/">Writing</a>
        <a href="https://brooksgroves.com/blog/">Blog</a>
        <a href="https://github.com/bdgroves/hoplore">HopLove on GitHub</a>
      </div>
    </div>

    <div class="footer-contact">
      <div class="fc-item">
        <div class="fc-label">Email</div>
        <a href="mailto:contact@brooksgroves.com">contact@brooksgroves.com</a>
      </div>
      <div class="fc-item">
        <div class="fc-label">Based in</div>
        <div class="fc-value">Lakewood, Washington</div>
      </div>
      <div class="fc-item">
        <div class="fc-label">Timezone</div>
        <div class="fc-value">Pacific &middot; UTC&minus;8 / &minus;7</div>
      </div>
      <div class="fc-item">
        <div class="fc-label">Replies</div>
        <div class="fc-value">Usually within a few days</div>
      </div>
    </div>

    <p class="footer-bottom">
      <span>&copy; 2026 Brooks Groves &middot; Lakewood, WA &middot; <a href="https://brooksgroves.com/about.html">About</a> &middot; <a href="https://brooksgroves.com/tags.html">Tags</a></span>
      <a href="#top">&uarr; Back to top</a>
    </p>
  </div>
</footer>`;
