# enCAGE web app

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
4. (Recommended) In Render's environment variables, add
   `ALLOWED_ORIGIN = https://<your-project>.pages.dev` once you know your
   Pages URL, so only your frontend can call the API. It defaults to `*`
   (any origin) if you skip this.

**3. Point the frontend at that backend:**
Edit `webapp/frontend/config.js`:
```js
window.ENCAGE_API_BASE = "https://encage-api.onrender.com";
```
Commit and push that change.

**4. Deploy the frontend on Cloudflare Pages:**
1. [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** →
   "Create" → "Pages" → "Connect to Git" → select your repo.
2. Build settings: **Framework preset** = "None", **Build command** = blank
   (leave empty — there's nothing to build), **Build output directory** =
   `webapp/frontend`.
3. Deploy. You get a public `https://<your-project>.pages.dev` URL.
4. Optional: attach a custom domain under the Pages project's "Custom
   domains" tab.

That's it — the Pages URL is what you share; it calls the Render URL behind
the scenes. If you rename the Render service later, just update
`frontend/config.js` and push again (Pages redeploys automatically on push).

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
