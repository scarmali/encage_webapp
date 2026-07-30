"""
enCAGE web app
==============
Flask backend for the enCAGE (Cargo Assessment for Guided Encapsulation) tool:
predicts the likely ferritin-nanocage encapsulation regime (I / II / III) for a
protein cargo, from its PDB structure.

Routes
------
GET  /                  -> serves the frontend (templates/index.html) - only used
                           when this app serves the frontend itself (single-service
                           deployment). If you're hosting the frontend separately
                           on Cloudflare Pages, this route is simply unused.
GET  /about             -> plain-language explainer for assembly regimes and
                           descriptors (templates/about.html); same caveat as above.
POST /api/analyze       -> multipart form: 'pdb_file' (upload) OR 'pdb_id'
                           (fetched live from RCSB), plus optional 'ph',
                           'cationic_threshold', 'net_charge', 'ses_volume_a3',
                           'multidomain' ('true'/'false'; omit/blank -> unresolved
                           for oversized cargo, see encage_core.classify_regime)
GET  /api/health        -> simple healthcheck for deployment platforms

CORS
----
When the frontend is hosted on a different domain (Cloudflare Pages, served at
https://encage.app) than this API (Render, served at https://api.encage.app),
the browser enforces CORS. Set the ALLOWED_ORIGIN environment variable to the
frontend's origin - scheme + host, no trailing slash, matching the browser's
Origin header exactly. render.yaml sets it to https://encage.app; it falls back
to "*" (any origin) when unset, which is fine for local development.

Note that .app is an HSTS-preloaded TLD: browsers will not load either host over
plain HTTP, so both frontend and API must be HTTPS in production.
"""

import os
import re
import tempfile

import requests
from flask import Flask, request, jsonify, render_template
from flask_cors import CORS

from encage_core import analyze_pdb, AnalysisError, __version__ as ENCAGE_VERSION

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 20 * 1024 * 1024  # 20 MB upload cap

ALLOWED_ORIGIN = os.environ.get("ALLOWED_ORIGIN", "*")
CORS(app, resources={r"/api/*": {"origins": ALLOWED_ORIGIN}})

RCSB_URL = "https://files.rcsb.org/download/{id}.pdb"
PDB_ID_RE = re.compile(r"^[A-Za-z0-9]{4}$")


def _parse_tristate_bool(value):
    """'true'/'false' (case-insensitive) -> True/False; anything else (incl.
    missing/blank) -> None, meaning 'unresolved' - matches encage_core's
    multidomain semantics, so we never silently guess."""
    if value is None:
        return None
    value = value.strip().lower()
    if value == "true":
        return True
    if value == "false":
        return False
    return None


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/about")
def about():
    return render_template("about.html")


@app.route("/api/health")
def health():
    """Healthcheck, and the canonical answer to "which encage_core is deployed?"

    encage_core.py is vendored into this repo from github.com/scarmali/encage,
    so reporting its version here makes a stale copy detectable without diffing.
    """
    return jsonify(status="ok", encage_core_version=ENCAGE_VERSION)


@app.route("/api/analyze", methods=["POST"])
def api_analyze():
    tmp_path = None
    try:
        pdb_id = (request.form.get("pdb_id") or "").strip()
        uploaded = request.files.get("pdb_file")

        ph = request.form.get("ph", type=float)
        cationic_threshold = request.form.get("cationic_threshold", type=float)
        net_charge_override = request.form.get("net_charge", type=float)
        volume_override = request.form.get("ses_volume_a3", type=float)
        multidomain = _parse_tristate_bool(request.form.get("multidomain"))

        overrides = {}
        if net_charge_override is not None:
            overrides["net_charge"] = net_charge_override
        if volume_override is not None:
            overrides["ses_volume_A3"] = volume_override

        if uploaded and uploaded.filename:
            stem = os.path.splitext(os.path.basename(uploaded.filename))[0]
            fd, tmp_path = tempfile.mkstemp(suffix=".pdb")
            os.close(fd)
            uploaded.save(tmp_path)
        elif pdb_id:
            if not PDB_ID_RE.match(pdb_id):
                return jsonify(error="PDB ID must be exactly 4 alphanumeric characters, e.g. 4CHA."), 400
            stem = pdb_id.upper()
            resp = requests.get(RCSB_URL.format(id=pdb_id.upper()), timeout=20)
            if resp.status_code != 200 or not resp.text.strip():
                return jsonify(
                    error=f"Could not fetch PDB ID '{pdb_id.upper()}' from RCSB. "
                          "Double-check the ID, or upload a .pdb file instead."
                ), 400
            fd, tmp_path = tempfile.mkstemp(suffix=".pdb")
            os.close(fd)
            with open(tmp_path, "w") as f:
                f.write(resp.text)
        else:
            return jsonify(error="Please upload a .pdb file or enter a PDB ID."), 400

        result = analyze_pdb(
            tmp_path, stem,
            pH=ph,
            cationic_threshold=cationic_threshold,
            overrides=overrides,
            multidomain=multidomain,
        )
        return jsonify(result)

    except AnalysisError as e:
        return jsonify(error=str(e)), 400
    except requests.RequestException:
        return jsonify(error="Network error while fetching structure from RCSB. Please try again."), 502
    except Exception as e:
        return jsonify(error=f"Unexpected error while analysing structure: {e}"), 500
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.remove(tmp_path)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)
