// Brooks's login: the "🔒 Brooks" button in the footer. The right password
// turns on owner mode in this browser (the same switch as ?me), which shows
// Edit this beer, Rate it and the owner side of the scan page.
//
// This is a convenience, not a lock: the site is static, so anyone who reads
// this file can flip the switch. What actually protects the data is that the
// HopLove workflows only act on issues opened from Brooks's GitHub account
// (or saved through the Worker with his key). A visitor who "logs in" just
// sees forms whose saves get ignored.

const HASH = '39a6f4b7c4c7b046f7c35834b69956164d05f03d171d7a450438391e6bc8b154'; // sha-256 of the password

const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* private mode */ } };

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const link = document.getElementById('owner-link');
if (link) {
  const loggedIn = () => get('hoplove_me') === '1';
  link.textContent = loggedIn() ? '🔓 Log out' : '🔒 Brooks';
  link.addEventListener('click', async () => {
    if (loggedIn()) {
      set('hoplove_me', null);
      location.reload();
      return;
    }
    const pw = window.prompt('Password');
    if (pw == null) return;
    if ((await sha256(pw.trim().toLowerCase())) !== HASH) {
      window.alert('Nope — that’s not it.');
      return;
    }
    set('hoplove_me', '1');
    // The Worker's owner key, unless a longer one was already set with ?key=.
    if (!get('hoplove_key')) set('hoplove_key', pw.trim().toLowerCase());
    location.reload();
  });
}
