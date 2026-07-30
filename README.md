# enCAGE web app

Live at **[encage.app](https://encage.app)**.

A mobile-friendly web interface for **enCAGE** (Cargo Assessment for Guided
Encapsulation) — predicts the likely ferritin-nanocage encapsulation outcome
for a protein cargo from its PDB structure, following the descriptor-guided
framework described in the accompanying manuscript:

- **Regime I** — efficient luminal encapsulation (cargo fits within the ~8 nm
  cavity)
- **Regime II** — structural-organisation-dependent accommodation (oversized
  cargo, but multidomain/flexible)
- **Regime III** — charge-driven off-pathway assembly (strongly cationic
  surface)
- **Predicted: no encapsulation** — oversized cargo with a single-domain/rigid
  architecture, so adaptive packing into the cavity is not expected

It wraps the same descriptor logic as `ferritin_regime_predictor.py`
(net charge at pH 7.4, Dmax, cavity volume ratio), refactored into
`encage_core.py` so it can run behind a web API instead of the command line.

`encage_core.py` is maintained in its own repository —
[github.com/scarmali/encage](https://github.com/scarmali/encage) — which is the
citable, archived version and the one to use if you want the library rather than
the interface. The copy vendored here is kept in sync with it; make changes to the
science upstream, not in this repo.

### Keeping the vendored copy in sync

`encage_core.py` carries a `__version__` string. The API reports it at
`/api/health`, and the About page footer shows it, so the deployed version is
always checkable without diffing files:

```bash
curl https://api.encage.app/api/health
# {"encage_core_version": "0.1.0", "status": "ok"}
```

To pull in an upstream change:

1. In the upstream repo, bump `__version__` — minor/major if a prediction could
   change for the same input, patch otherwise — and tag a release.
2. Copy the new `encage_core.py` over the one here, commit, push. Render
   redeploys automatically.
3. Hit `/api/health` and confirm the version matches the upstream tag.

If the footer version lags behind the upstream release, the vendored copy is
stale.

### The `multidomain` flag

Electrostatics is checked first (Regime III), then size against the ~8 nm
cavity (Regime I if it fits). For cargo that clears the electrostatic check
but is **oversized**, the call depends on whether the cargo is multidomain /
conformationally flexible — something that can't be determined from a single
static structure, so it's a user-supplied flag rather than something enCAGE
infers automatically:

| `multidomain` | Outcome |
|---|---|
| `True` | Regime II (accommodation) |
| `False` | Predicted: no encapsulation (oversized, single-domain/rigid) |
| `None` (default) | Unresolved — flagged with guidance to specify `True`/`False` rather than silently defaulting to Regime II |

Predicted non-encapsulation is reported as **`NE`**, not as a "Regime IV". Regimes
I–III were each characterised experimentally; this outcome falls outside all three,
follows from the logic of the framework rather than from data (the calibration panel
contained no oversized rigid single-domain cargo), and remains to be tested. The app
shows it without a Roman numeral for that reason.

The command-line `ferritin_regime_predictor.py` in the repo root implements the same
branch and is kept in lockstep with `encage_core.py`. There, set the flag per protein
via a `multidomain` column in `--overrides`, or globally with `--multidomain yes|no`.

## What's different from the original script

- **Volume**: the server does not have ChimeraX installed, so steric volume
  is estimated with a fast grid-based van-der-Waals approximation instead of
  ChimeraX's solvent-excluded surface. This is flagged in the UI as
  "grid van der Waals estimate (approximate)". If you have a ChimeraX SES
  volume or a Prot pi net charge for your protein, enter it under
  **Advanced options** to get the manuscript-consistent number instead.
- **Input**: upload a `.pdb` file directly, or just type a 4-character PDB ID
  (e.g. `4CHA`) and the app fetches it live from RCSB.

## Run it locally

```bash
cd webapp
pip install -r requirements.txt
python app.py
```

Then open `http://localhost:5000` in a browser — on your phone too, if it's
on the same Wi-Fi network as your computer (use your computer's local IP
instead of `localhost`, e.g. `http://192.168.1.23:5000`).

## Deploy it publicly

There are two ways to host this. Pick one.

### Option A — single service (simplest)

Render or Railway host the whole app (Flask serves both the API and the
`templates/`/`static/` frontend from one URL).

**Render**
1. Push this `webapp/` folder to a GitHub repo.
2. In Render, "New +" → "Web Service" → connect the repo.
3. Render detects `render.yaml` automatically (build: `pip install -r
   requirements.txt`, start: `gunicorn app:app`).
4. Deploy — you get a public `https://encage-xxxx.onrender.com` URL, done.

**Railway**
1. Push to GitHub, then in Railway: "New Project" → "Deploy from GitHub repo".
2. Railway auto-detects the `Procfile` and Python buildpack — no extra config.

Both free tiers spin down after inactivity, so the first request after a
while may take 20-30 seconds to wake up.

### Option B — GitHub + Cloudflare Pages (frontend) + Render (backend)

Cloudflare Pages only serves **static** sites — it cannot run the Flask/Python
backend (Biopython, SciPy, etc. need a real Python runtime). So the app is
split in two: Pages hosts `frontend/` (static HTML/CSS/JS), Render hosts the
API. The `frontend/` folder already talks to the backend over a configurable
URL, so no code changes are needed beyond one config line.

**1. Push the whole `webapp/` folder to a GitHub repo**, e.g.:
```bash
cd webapp
git init
git add .
git commit -m "enCAGE web app"
git branch -M main
git remote add origin https://github.com/<you>/encage.git
git push -u origin main
```
All the files listed under **File structure** below should be in the repo —
Cloudflare Pages and Render each only read the subfolder they need.

**2. Deploy the backend on Render first** (you need its URL before finishing
the frontend):
1. [dashboard.render.com](https://dashboard.render.com) → "New +" → "Web
   Service" → connect your GitHub repo.
2. Set **Root Directory** to `webapp` (Render will pick up `render.yaml` from
   there — build `pip install -r requirements.txt`, start `gunicorn app:app`).
3. Deploy. Copy the resulting URL, e.g. `https://encage-api.onrender.com`.
4. Under the service's **Settings → Custom Domains**, add `api.encage.app`, then
   create the CNAME record Render shows you at your DNS provider. Render issues
   the TLS certificate automatically once the record resolves.
5. `render.yaml` already sets `ALLOWED_ORIGIN = https://encage.app`, so only the
   deployed frontend can call `/api/*`. If you serve the frontend from somewhere
   else, change it there (or override it in Render's environment variables) —
   it must match the browser's `Origin` header exactly: scheme + host, no
   trailing slash. Unset, it falls back to `*` (any origin).

**3. Point the frontend at that backend:**
`webapp/frontend/config.js` is already set to the production backend:
```js
window.ENCAGE_API_BASE = "https://api.encage.app";
```
Using the subdomain rather than the raw `.onrender.com` URL means you can move
the backend later by changing a DNS record instead of shipping a code change.
If you'd rather skip the subdomain, put the `.onrender.com` URL here instead
and set `ALLOWED_ORIGIN` to match your frontend's origin.

**4. Deploy the frontend on Cloudflare Pages:**
1. [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** →
   "Create" → "Pages" → "Connect to Git" → select your repo.
2. Build settings: **Framework preset** = "None", **Build command** = blank
   (leave empty — there's nothing to build), **Build output directory** =
   `webapp/frontend`.
3. Deploy. You get a public `https://<your-project>.pages.dev` URL.
4. Under the Pages project's **Custom domains** tab, add `encage.app` (and
   `www.encage.app` if you want it to redirect). If the domain's nameservers
   are already on Cloudflare, the DNS records are created for you.

That's it — `https://encage.app` is what you share; it calls `api.encage.app`
behind the scenes. If you move the backend later, repoint the `api` CNAME
rather than editing `config.js`.

### A note on `.app` and HTTPS

`.app` is on the HSTS preload list, so browsers refuse to load either host over
plain HTTP — there is no insecure fallback to debug against. Two consequences:

- Both the Pages site and the Render API must be HTTPS. Both are by default,
  so this is normally invisible.
- A page loaded from `https://encage.app` can never call `http://localhost:5000`.
  For local work, run the frontend locally too (`python app.py`, or any static
  server over the `frontend/` folder) and point `ENCAGE_API_BASE` at localhost —
  just don't commit that change.

## File structure

```
webapp/
├── app.py               # Flask routes (upload / PDB-ID fetch / analyze API) — used by Render
├── encage_core.py        # descriptor + regime prediction logic (importable)
├── requirements.txt       # includes flask-cors, needed for the split (Option B) setup
├── Procfile               # for Render/Railway (Option A)
├── render.yaml            # Render service config
├── templates/
│   └── index.html         # frontend used ONLY when Flask serves it itself (Option A)
├── static/
│   ├── style.css
│   └── script.js
└── frontend/              # standalone static frontend for Cloudflare Pages (Option B)
    ├── index.html
    ├── style.css
    ├── script.js
    └── config.js           # <- set window.ENCAGE_API_BASE to your Render URL here
```

## Citation

If you use enCAGE, please cite:

> [Author list]. enCAGE: Cargo Assessment for Guided Encapsulation.
> Zenodo. https://doi.org/XX.XXXX/zenodo.XXXXXXX

<!-- TODO: replace with the Zenodo concept DOI once the GitHub release has
     been archived (see repo root for release/archiving steps). The concept
     DOI always resolves to the latest version. -->

## Notes / limitations

- enCAGE is a heuristic design aid calibrated on a small in-house cargo panel
  (equine apoferritin, pH cycling) — not a validated classifier. Treat Regime
  II calls especially as "worth testing", not certainty.
- Net charge is estimated with a built-in Henderson-Hasselbalch calculation
  and typically differs from Prot pi by ~1-1.5 units; supply a Prot pi value
  under Advanced options for the definitive call.
- Very large multi-chain assemblies may take a few seconds longer to process
  because of the grid volume estimate.
