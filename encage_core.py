"""
encage_core.py

Core descriptor-and-regime logic for enCAGE (Cargo Assessment for Guided
Encapsulation), refactored from ferritin_regime_predictor.py for use behind a
web API. Same science, same thresholds - just importable / return-value based
instead of CLI / print-and-CSV based.

Calibration note
-----------------
Regime boundaries are calibrated on a small in-house cargo panel (equine
apoferritin, pH cycling). This tool is a heuristic DESIGN AID / hypothesis
generator, not a validated classifier.

Volume note
-----------
A production web server will not generally have ChimeraX installed, so this
module computes the steric descriptor with a grid-based van-der-Waals-union
volume approximation (fast, dependency-free) and clearly labels it as such.
Users who have the manuscript-consistent ChimeraX solvent-excluded volume (or
a Prot pi net charge) for their protein can supply either/both as overrides
and they will be used verbatim.
"""

import numpy as np
from scipy.spatial import distance, cKDTree
from Bio.PDB import PDBParser

# Bump on every release of the upstream repo (github.com/scarmali/encage), then
# re-copy this file into the web app repo. The web app reports this string at
# /api/health and in its About page footer, so a stale vendored copy is visible
# rather than silent. Semantic versioning: bump the minor/major component if a
# prediction could change for the same input, the patch component otherwise.
#
# 1.0.0 is reserved for the release cited in the manuscript. Pre-publication
# releases stay on 0.x, where the 0 major signals that thresholds and outputs
# may still change.
__version__ = "0.1.1"

parser = PDBParser(QUIET=True)

# --------------------------------------------------------------------------- #
# CONFIG (thresholds encode the framework; adjust as data accrue)
# --------------------------------------------------------------------------- #
CAVITY_VOLUME_NM3 = 268.0     # equine apoferritin lumen (manuscript Table 1)
CAVITY_DMAX_NM = 8.0          # nominal cavity diameter

DEFAULTS = dict(
    cationic_threshold=5.0,   # net charge >= this -> Regime III (off-pathway)
    cationic_warn_low=3.0,    # cautionary cationic band lower edge
    high_occupancy=0.5,       # volume ratio above which Regime I loading may drop
    pH=7.4,
)

# EMBOSS pKa set (used for the built-in net-charge ESTIMATE)
PKA = dict(Nt=8.6, Ct=3.6, K=10.8, R=12.5, H=6.5, D=3.9, E=4.1, C=8.5, Y=10.1)

THREE2ONE = {
    'ALA': 'A', 'ARG': 'R', 'ASN': 'N', 'ASP': 'D', 'CYS': 'C', 'GLN': 'Q',
    'GLU': 'E', 'GLY': 'G', 'HIS': 'H', 'ILE': 'I', 'LEU': 'L', 'LYS': 'K',
    'MET': 'M', 'PHE': 'F', 'PRO': 'P', 'SER': 'S', 'THR': 'T', 'TRP': 'W',
    'TYR': 'Y', 'VAL': 'V',
    'MSE': 'M', 'SEC': 'C', 'PYL': 'K', 'CRO': '', 'CR2': '', 'CRQ': '', 'NRQ': '',
}

ATOM_RADII = {"C": 1.70, "N": 1.55, "O": 1.52, "S": 1.80, "P": 1.80, "SE": 1.90,
              "FE": 1.80, "ZN": 1.39, "MG": 1.73, "CA": 1.90, "NA": 1.90,
              "K": 2.75, "CL": 1.75}


class AnalysisError(Exception):
    pass


# --------------------------------------------------------------------------- #
# Geometry
# --------------------------------------------------------------------------- #
def load_structure_from_path(pdb_path, chains=None):
    """Parse a PDB file into heavy-atom coordinates.

    chains: optional iterable of chain IDs to restrict to (default: all chains).
    HETATM records (ligands, waters, ions) are always excluded.
    """
    structure = parser.get_structure("protein", pdb_path)
    chain_set = set(chains) if chains is not None else None
    coords, elements = [], []
    for atom in structure.get_atoms():
        if atom.element == "H":
            continue
        residue = atom.get_parent()
        if residue.id[0] != " ":
            continue
        if chain_set is not None and residue.get_parent().id not in chain_set:
            continue
        coords.append(atom.coord)
        elements.append(atom.element)
    if len(coords) < 10:
        raise AnalysisError(
            "Fewer than 10 heavy atoms were parsed from this file. Please check "
            "that it is a valid, non-empty PDB structure file."
        )
    return structure, np.array(coords), elements


def principal_dimensions(coords):
    centroid = coords.mean(axis=0)
    centered = coords - centroid
    cov = np.cov(centered.T)
    eigvals, eigvecs = np.linalg.eigh(cov)
    order = np.argsort(eigvals)[::-1]
    eigvals = eigvals[order]
    eigvecs = eigvecs[:, order]
    rotated = centered @ eigvecs
    dims = np.sort(rotated.max(axis=0) - rotated.min(axis=0))[::-1]
    return dims, centered, eigvals


def maximum_dimension(coords, cap_atoms=6000):
    # pairwise distance is O(n^2); subsample very large structures for speed
    if len(coords) > cap_atoms:
        idx = np.random.RandomState(0).choice(len(coords), cap_atoms, replace=False)
        coords = coords[idx]
    return distance.pdist(coords).max()


def relative_shape_anisotropy(eigvals):
    l1, l2, l3 = eigvals
    rg2 = l1 + l2 + l3
    num = (l1 - l2) ** 2 + (l2 - l3) ** 2 + (l3 - l1) ** 2
    return num / (2 * rg2 ** 2)


# --------------------------------------------------------------------------- #
# Electrostatics
# --------------------------------------------------------------------------- #
def sequence_from_structure(structure):
    seq, unknown = [], []
    for res in structure.get_residues():
        if res.id[0] != " ":  # hetero / water
            continue
        aa = THREE2ONE.get(res.resname.strip())
        if aa is None:
            unknown.append(res.resname.strip())
        elif aa != "":
            seq.append(aa)
    return "".join(seq), sorted(set(unknown))


def net_charge(seq, pH, n_termini=1):
    if not seq:
        return float("nan")
    q = 0.0
    q += n_termini * 1 / (1 + 10 ** (pH - PKA['Nt']))
    q -= n_termini * 1 / (1 + 10 ** (PKA['Ct'] - pH))
    for aa in ('K', 'R', 'H'):
        q += seq.count(aa) / (1 + 10 ** (pH - PKA[aa]))
    for aa in ('D', 'E', 'C', 'Y'):
        q -= seq.count(aa) / (1 + 10 ** (PKA[aa] - pH))
    return q


# --------------------------------------------------------------------------- #
# Volume: grid van-der-Waals-union approximation (no external binary needed)
# --------------------------------------------------------------------------- #
def grid_vdw_volume(coords, elements, spacing=0.9, max_atoms=8000):
    """Approximate molecular (van der Waals union) volume in A^3.
    Underestimates true solvent-excluded volume (no probe rolling), but is a
    fast, dependency-free stand-in when ChimeraX is unavailable.
    """
    if len(coords) > max_atoms:
        idx = np.random.RandomState(0).choice(len(coords), max_atoms, replace=False)
        coords = coords[idx]
        elements = [elements[i] for i in idx]

    radii = np.array([ATOM_RADII.get(e.upper(), 1.70) for e in elements])
    lo = coords.min(0) - radii.max() - spacing
    hi = coords.max(0) + radii.max() + spacing
    gx = np.arange(lo[0], hi[0], spacing)
    gy = np.arange(lo[1], hi[1], spacing)
    gz = np.arange(lo[2], hi[2], spacing)
    tree = cKDTree(coords)
    occ = 0
    XY = np.array(np.meshgrid(gx, gy, indexing="ij")).reshape(2, -1).T
    for z in gz:
        pts = np.column_stack([XY, np.full(len(XY), z)])
        d, idx2 = tree.query(pts, k=1)
        occ += np.count_nonzero(d <= radii[idx2])
    return occ * spacing ** 3


# --------------------------------------------------------------------------- #
# Regime decision (identical logic/thresholds to ferritin_regime_predictor.py)
# --------------------------------------------------------------------------- #
def classify_regime(q, dmax_nm, vol_ratio, cfg, multidomain=None):
    """Electrostatics -> sterics -> structural-organisation regime call.

    multidomain: only consulted for oversized cargo (Dmax > cavity) that has
    already passed the electrostatic check. None means "not yet resolved" and
    is reported as such rather than silently treated as Regime II.
        True  -> Regime II (accommodation)
        False -> "NE" / "Predicted: no encapsulation" (oversized + single-domain/rigid)
        None  -> unresolved; caller must supply multidomain=True/False

    Note on "NE": predicted non-encapsulation is deliberately NOT numbered as a
    fourth regime. Regimes I-III are experimentally characterised; the oversized
    single-domain/rigid branch falls outside all three and is a prediction of the
    framework that remains to be tested (no such cargo was in the calibration
    panel). The code is returned as "NE" so downstream consumers cannot mistake
    it for a validated regime.
    """
    notes = []
    if not np.isnan(q) and q >= cfg["cationic_threshold"]:
        notes.append("Strongly cationic surface favours charge-driven off-pathway assembly.")
        if q < cfg["cationic_threshold"] + 1.5:
            notes.append("Net charge sits close to the Regime III threshold - call is tentative.")
        return "III", "Charge-driven off-pathway assembly", notes
    if not np.isnan(q) and q >= cfg["cationic_warn_low"]:
        notes.append(
            "Net charge is in the cautionary cationic band (%.0f to %.0f) - Regime III is not excluded."
            % (cfg["cationic_warn_low"], cfg["cationic_threshold"])
        )
    if dmax_nm <= CAVITY_DMAX_NM:
        if not np.isnan(vol_ratio) and vol_ratio > cfg["high_occupancy"]:
            notes.append(
                "High cavity occupancy (volume ratio %.2f) - loading efficiency may be reduced."
                % vol_ratio
            )
        return "I", "Efficient luminal encapsulation", notes

    notes.append(
        "Dmax exceeds the ~8 nm cavity: encapsulation depends on multidomain flexibility / "
        "adaptive packing, which cannot be judged from a single static structure."
    )
    if multidomain is True:
        return "II", "Accommodation possible - structural-organisation dependent", notes
    if multidomain is False:
        notes.append(
            "Oversized cargo with single-domain/rigid architecture: adaptive packing is not "
            "expected, so encapsulation is not predicted."
        )
        notes.append(
            "This outcome falls outside Regimes I-III. It is a prediction of the framework "
            "rather than an experimentally characterised regime, and remains to be tested."
        )
        return "NE", "Predicted: no encapsulation", notes
    notes.append(
        "oversized cargo; specify multidomain=True/False to resolve - Regime II if "
        "multidomain/flexible, predicted non-encapsulation if single-domain rigid."
    )
    return "II/NE (unresolved)", "Unresolved - multidomain flag required", notes


# --------------------------------------------------------------------------- #
# Public entry point
# --------------------------------------------------------------------------- #
def analyze_pdb(pdb_path, stem, pH=None, cationic_threshold=None, overrides=None,
                 multidomain=None, chains=None):
    """Run the full descriptor + regime pipeline on one PDB file.

    overrides: optional dict with any of 'net_charge', 'ses_volume_A3' (floats).
    multidomain: user-supplied per-cargo flag (True/False/None) consulted only
        for oversized cargo; see classify_regime. Not auto-detected.
    chains: optional iterable of chain IDs to restrict the structure to.
    Returns a plain dict, JSON-serialisable.
    """
    overrides = overrides or {}
    cfg = dict(DEFAULTS)
    if pH is not None:
        cfg["pH"] = pH
    if cationic_threshold is not None:
        cfg["cationic_threshold"] = cationic_threshold

    structure, coords, elements = load_structure_from_path(pdb_path, chains=chains)
    dims, centered, eigvals = principal_dimensions(coords)
    L, W, T = dims
    dmax_A = maximum_dimension(coords)
    dmax_nm = dmax_A / 10.0
    kappa2 = relative_shape_anisotropy(eigvals)

    seq, unknown_residues = sequence_from_structure(structure)
    if overrides.get("net_charge") is not None:
        q = float(overrides["net_charge"])
        q_src = "provided"
    else:
        q = net_charge(seq, cfg["pH"])
        q_src = "estimated (Henderson-Hasselbalch)"

    mw_kda = None
    if seq:
        try:
            from Bio.SeqUtils.ProtParam import ProteinAnalysis
            mw_kda = round(ProteinAnalysis(seq).molecular_weight() / 1000.0, 1)
        except Exception:
            mw_kda = None

    if overrides.get("ses_volume_A3") is not None:
        vol_A3 = float(overrides["ses_volume_A3"])
        v_src = "provided"
    else:
        vol_A3 = grid_vdw_volume(coords, elements)
        v_src = "grid van der Waals estimate (approximate)"

    vol_nm3 = vol_A3 / 1000.0 if vol_A3 == vol_A3 else float("nan")
    vol_ratio = vol_nm3 / CAVITY_VOLUME_NM3 if vol_nm3 == vol_nm3 else float("nan")

    regime_num, regime_label, notes = classify_regime(q, dmax_nm, vol_ratio, cfg, multidomain=multidomain)

    if unknown_residues:
        notes.append(
            "Non-standard residues ignored in the charge calculation: " + ", ".join(unknown_residues)
        )

    return dict(
        protein=stem.upper(),
        length_nm=round(L / 10, 2),
        width_nm=round(W / 10, 2),
        thickness_nm=round(T / 10, 2),
        dmax_nm=round(dmax_nm, 2),
        volume_nm3=round(vol_nm3, 2) if vol_nm3 == vol_nm3 else None,
        volume_ratio=round(vol_ratio, 3) if vol_ratio == vol_ratio else None,
        volume_source=v_src,
        net_charge=round(q, 2) if q == q else None,
        charge_source=q_src,
        molecular_weight_kda=mw_kda,
        ph=cfg["pH"],
        cationic_threshold=cfg["cationic_threshold"],
        cationic_warn_low=cfg["cationic_warn_low"],
        kappa2=round(kappa2, 3),
        multidomain=multidomain,
        regime_number=regime_num,
        regime_label=regime_label,
        notes=notes,
    )
