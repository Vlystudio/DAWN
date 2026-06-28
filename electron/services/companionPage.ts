/* The login gate served at '/' by companion.ts. On success it stores the session
 * token and forwards to '/app', which serves DAWN's real React app (full brain +
 * every view) via the window.dawn HTTP bridge. Keep as a plain string. */
export const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1" />
<meta name="theme-color" content="#0a0a0f" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<meta name="apple-mobile-web-app-title" content="DAWN" />
<link rel="manifest" href="/manifest.webmanifest" />
<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
<link rel="icon" href="/icon.png" />
<title>DAWN</title>
<style>
  :root { --gold:#ffb020; --goldHot:#ffd27a; --bg:#0a0a0f; --panel2:#1b1b27; --border:#262635; --ink:#e8eaf2; --dim:#9aa0b4; --faint:#666c82; }
  * { box-sizing:border-box; -webkit-tap-highlight-color:transparent; }
  html,body { margin:0; height:100%; background:var(--bg); color:var(--ink); font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
  body { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:16px; padding:24px; min-height:100dvh; }
  .reactor { width:72px; height:72px; border-radius:50%; background:radial-gradient(circle at 50% 42%,var(--goldHot),var(--gold) 55%,#7a4d06 100%); box-shadow:0 0 34px rgba(255,176,32,.55); }
  h1 { margin:4px 0 0; letter-spacing:.22em; font-size:26px; }
  p { color:var(--dim); margin:0; text-align:center; font-size:13px; max-width:300px; }
  input { width:220px; text-align:center; letter-spacing:.4em; font-size:24px; background:var(--panel2); border:1px solid var(--border); color:var(--ink); border-radius:14px; padding:13px; outline:none; }
  input:focus { border-color:rgba(255,176,32,.5); box-shadow:0 0 0 2px rgba(255,176,32,.14); }
  button { width:220px; background:linear-gradient(180deg,var(--goldHot),var(--gold)); color:#1a1205; border:none; border-radius:14px; padding:14px; font-weight:700; font-size:16px; }
  button:disabled { opacity:.5; }
  #err { color:#f87171; font-size:13px; min-height:18px; }
  .sub { letter-spacing:.14em; font-size:11px; color:var(--faint); margin-top:-8px; }
</style>
</head>
<body>
  <div class="reactor"></div>
  <h1>DAWN</h1>
  <div class="sub">DIGITALLY AUTONOMOUS</div>
  <p>Enter the PIN from DAWN &rarr; Settings &rarr; Phone access.</p>
  <input id="pin" inputmode="numeric" autocomplete="one-time-code" placeholder="------" />
  <button id="go">Connect</button>
  <div id="err"></div>
<script>
(function(){
  var pin = document.getElementById('pin'), go = document.getElementById('go'), err = document.getElementById('err');
  var token = localStorage.getItem('dawn_token') || '';

  // Already have a token? Verify it, then go straight to the app.
  if(token){
    fetch('/api/info',{ headers:{ 'x-dawn-token': token } }).then(function(r){
      if(r.ok){ location.replace('/app'); }
      else { localStorage.removeItem('dawn_token'); }
    }).catch(function(){});
  }

  function login(){
    err.textContent=''; go.disabled=true; go.textContent='Connecting...';
    fetch('/api/login',{ method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ pin: pin.value.trim() }) })
      .then(function(r){ return r.json().then(function(j){ return { ok:r.ok, j:j }; }); })
      .then(function(x){
        if(x.ok && x.j.token){ localStorage.setItem('dawn_token', x.j.token); location.replace('/app'); }
        else { err.textContent = (x.j && x.j.error) || 'Login failed.'; go.disabled=false; go.textContent='Connect'; }
      })
      .catch(function(){ err.textContent='Cannot reach DAWN.'; go.disabled=false; go.textContent='Connect'; });
  }
  go.onclick = login;
  pin.addEventListener('keydown', function(e){ if(e.key==='Enter') login(); });
  pin.focus();
})();
</script>
</body>
</html>`;
