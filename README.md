# enCAGE web app

A mobile-friendly web interface for **enCAGE** (Cargo Assessment for Guided
Encapsulation) — predicts the likely ferritin-nanocage encapsulation regime
(I: efficient luminal encapsulation, II: structural-organisation-dependent
accommodation, III: charge-driven off-pathway assembly) for a protein cargo
from its PDB structure, following the descriptor-guided framework described
in the accompanying manuscript.

It wraps the same descriptor logic as `ferritin_regime_predictor.py`
(net charge at pH 7.4, Dmax, cavity volume ratio), refactored into
`encage_core.py` so it can run behind a web API instead of the command line.

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

## Deploy it publicly (free tier)

**Render**
1. Push this `webapp/` folder to a GitHub repo.
2. In Render, "New +" → "Web Service" → connect the repo.
3. Render will detect `render.yaml` automatically (build: `pip install -r
   requirements.txt`, start: `gunicorn app:app`).
4. Deploy — you'll get a public `https://encage-xxxx.onrender.com` URL.

**Railway**
1. Push to GitHub, then in Railway: "New Project" → "Deploy from GitHub repo".
2. Railway auto-detects the `Procfile` and Python buildpack — no extra config
   needed.

Both free tiers spin down after inactivity, so the first request after a
while may take 20-30 seconds to wake up.

## File structure

```
webapp/
├── app.py              # Flask routes (upload / PDB-ID fetch / analyze API)
├── encage_core.py       # descriptor + regime prediction logic (importable)
├── templates/
│   └── index.html       # single-page frontend
├── static/
│   ├── style.css         # mobile-first responsive styling
│   └── script.js         # upload/fetch, API calls, results rendering, CSV export
├── requirements.txt
├── Procfile              # for Render/Railway
└── render.yaml           # Render service config
```

## Notes / limitations

- enCAGE is a heuristic design aid calibrated on a small in-house cargo panel
  (equine apoferritin, pH cycling) — not a validated classifier. Treat Regime
  II calls especially as "worth testing", not certainty.
- Net charge is estimated with a built-in Henderson-Hasselbalch calculation
  and typically differs from Prot pi by ~1-1.5 units; supply a Prot pi value
  under Advanced options for the definitive call.
- Very large multi-chain assemblies may take a few seconds longer to process
  because of the grid volume estimate.
