ECHO-FLOW — Environmental Decision Intelligence OS (home page)

HOW TO RUN
1. Unzip the whole folder (keep the folder structure as-is).
2. Double-click index.html. It opens in Chrome / Edge / Firefox.
   No internet, no npm, no server needed. Everything (Three.js, fonts, images) is local.

OPTIONAL: run with a local server instead
   python -m http.server 8000     then open http://localhost:8000

FOLDERS
index.html        page structure
css/style.css     all styles
js/main.js        all interactions, canvas effects, satellite (Three.js)
vendor/           three.min.js (r128), local copy
assets/           all your images (WebP)
fonts/            Rajdhani + Inter, local

Routes (hash based, work from a double-click):
  index.html            home
  index.html#/echo-flow, #/rahat, #/waterpulse   system pages (placeholders for now)
