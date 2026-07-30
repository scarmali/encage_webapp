#!/usr/bin/env python3
"""
reproduce_tables.py

Regenerates the manuscript Table 1 (in-house cargo panel) and the Table 4
regime predictions (external literature validation) using enCAGE.

Table 1 is reproduced from the deposited PDB structures. The descriptors that
the manuscript computed with external tools are supplied as overrides so the
run matches the paper rather than the built-in fallback estimators:
    net charge : Prot pi (pH 7.4)        -> `net_charge` override
    SES volume : ChimeraX (probe 1.4 A)  -> `ses_volume_A3` override
Geometry (Dmax) is computed by enCAGE from the structure and checked against
Table 1. Cargo whose Dmax exceeds the ~8 nm cavity also carries a
`multidomain` flag (user-supplied, not auto-detected) so the regime call
resolves per encage_core.classify_regime, which returns Regimes I-III plus
the "NE" predicted-non-encapsulation branch (oversized + single-domain/rigid;
outside the three characterised regimes and untested). Cargo that resolves on
charge/sterics before that branch is reached still sets the flag explicitly
for clarity, even though it has no effect on the outcome.

Table 4 is reproduced at the level of the decision logic: the published
descriptors (net charge, Dmax, volume ratio) are passed to enCAGE's regime
classifier, and the predicted regime is compared with the manuscript. The a/b
suffixes in the paper are annotations marking cage-specific divergence between
the equine-calibrated prediction and the reported outcome in AfFtn/Bfr; enCAGE
returns the base regime (I/II/III), which is what is checked here.
"""

import os
import sys
import urllib.request

from encage_core import analyze_pdb, classify_regime, DEFAULTS

STRUCT_DIR = "structures"
RCSB_URL = "https://files.rcsb.org/download/{pid}.pdb"


# --------------------------------------------------------------------------- #
# Table 1 - in-house cargo panel (structure-based)
# --------------------------------------------------------------------------- #
TABLE1 = [
    dict(name="Lysozyme", pdb_id="1LYZ", chains=["A"],
         net_charge=6.24, ses_volume_A3=15880.0, multidomain=False,
         expected=dict(dmax_nm=4.74, volume_ratio=0.059, regime="III")),
    dict(name="alpha-Chymotrypsin", pdb_id="4CHA", chains=["A", "B", "C"],
         net_charge=0.77, ses_volume_A3=27117.0, multidomain=False,
         expected=dict(dmax_nm=5.24, volume_ratio=0.101, regime="I")),
    dict(name="Human Serum Albumin", pdb_id="1AO6", chains=["A"],
         net_charge=-18.89, ses_volume_A3=75570.0, multidomain=True,
         expected=dict(dmax_nm=9.3, volume_ratio=0.282, regime="II")),
]

# --------------------------------------------------------------------------- #
# Table 4 - external literature validation (descriptor-based).
# The GFP(-7.6) and GFP(-30) variants share the structural dimensions of the
# GFP beta-barrel (Dmax 5.3 nm, volume ratio 0.11); only the net charge differs.
# `annotated` is the paper's predicted-regime label; `outcome` is the reported
# experimental result in that cage system.
# --------------------------------------------------------------------------- #
TABLE4 = [
    dict(name="Cytochrome c",        cage="Chimeric AfFtn", q=8.4,   dmax=4.2, vr=0.05,
         base="III", annotated="IIIa", outcome="Encapsulated"),
    dict(name="GFP (+36)",           cage="AfFtn",          q=36.0,  dmax=5.3, vr=0.11,
         base="III", annotated="IIIa", outcome="Encapsulated"),
    dict(name="GFP (-7.6)",          cage="AfFtn",          q=-7.6,  dmax=5.3, vr=0.11,
         base="I",   annotated="Ia",   outcome="Not encapsulated"),
    dict(name="GFP (-30)",           cage="AfFtn",          q=-30.0, dmax=5.3, vr=0.11,
         base="I",   annotated="Ia",   outcome="Not encapsulated"),
    dict(name="[3Fe-4S] ferredoxin", cage="E. coli Bfr",    q=-8.1,  dmax=3.6, vr=0.03,
         base="I",   annotated="Ib",   outcome="Encapsulated (4-6 per cage)"),
]


def fetch_pdb(pdb_id):
    os.makedirs(STRUCT_DIR, exist_ok=True)
    path = os.path.join(STRUCT_DIR, f"{pdb_id}.pdb")
    if not os.path.exists(path):
        print(f"  downloading {pdb_id} from RCSB ...")
        urllib.request.urlretrieve(RCSB_URL.format(pid=pdb_id), path)
    return path


def close(a, b, tol):
    return a is not None and abs(a - b) <= tol


def reproduce_table1():
    print("=" * 74)
    print("TABLE 1  -  in-house cargo panel (reproduced from PDB structures)")
    print("=" * 74)
    ok_all = True
    for c in TABLE1:
        print(f"\n{c['name']}  ({c['pdb_id']}, chains {'+'.join(c['chains'])})")
        try:
            path = fetch_pdb(c["pdb_id"])
        except Exception as e:
            print(f"  ! could not obtain {c['pdb_id']}: {e}")
            ok_all = False
            continue
        # enCAGE handles chain selection and HETATM stripping internally
        res = analyze_pdb(path, stem=c["pdb_id"], chains=c["chains"],
                          multidomain=c["multidomain"],
                          overrides=dict(net_charge=c["net_charge"],
                                         ses_volume_A3=c["ses_volume_A3"]))
        exp = c["expected"]
        print(f"    net charge (Prot pi, supplied) : {res['net_charge']:+.2f}")
        print(f"    SES volume (ChimeraX, supplied): {res['volume_nm3']} nm^3")
        for label, got, want, tol in [
            ("volume ratio (derived)", res["volume_ratio"], exp["volume_ratio"], 0.002),
            ("Dmax nm (computed)",     res["dmax_nm"],      exp["dmax_nm"],      0.20),
        ]:
            ok = close(got, want, tol); ok_all &= ok
            print(f"    {label:31}: {got}  (table {want})  [{'OK' if ok else 'CHECK'}]")
        reg_ok = res["regime_number"] == exp["regime"]; ok_all &= reg_ok
        print(f"    {'regime (predicted)':31}: Regime {res['regime_number']}"
              f"  (table Regime {exp['regime']})  [{'OK' if reg_ok else 'CHECK'}]")
    return ok_all


def reproduce_table4():
    print("\n" + "=" * 74)
    print("TABLE 4  -  external validation (regime logic from published descriptors)")
    print("=" * 74)
    print(f"\n{'cargo':22}{'cage':16}{'q':>7}  enCAGE paper   reported outcome")
    print("-" * 74)
    ok_all = True
    for c in TABLE4:
        num, label, notes = classify_regime(c["q"], c["dmax"], c["vr"], DEFAULTS)
        ok = num == c["base"]; ok_all &= ok
        flag = "OK" if ok else "CHECK"
        print(f"{c['name']:22}{c['cage']:16}{c['q']:>+7.1f}  {num:>5} {c['annotated']:>5}   "
              f"{c['outcome']:<24}[{flag}]")
    print("-" * 74)
    print("enCAGE returns the base regime (I/II/III) from equine-calibrated thresholds.")
    print("Where the predicted regime and the reported outcome diverge (suffix a/b in")
    print("the paper), the divergence is cage-specific:")
    print("  a  cationic cargo predicted off-pathway in equine apoferritin is")
    print("     productively encapsulated by AfFtn (charge-complementary co-assembly);")
    print("  b  acidic cargo in Bfr is encapsulated via a cage-specific haem-binding")
    print("     pocket rather than electrostatic complementarity.")
    print("enCAGE thus reproduces the regime assignments within its calibrated system")
    print("and flags, rather than obscures, where cage-specific boundaries shift.")
    return ok_all


def main():
    ok1 = reproduce_table1()
    ok4 = reproduce_table4()
    print("\n" + "=" * 74)
    parts = [
        "Table 1 reproduced." if ok1 else "Table 1: some rows flagged [CHECK].",
        "Table 4 regimes reproduced." if ok4 else "Table 4: some rows flagged [CHECK].",
    ]
    print("  " + "  ".join(parts))
    print("=" * 74)
    return 0 if (ok1 and ok4) else 1


if __name__ == "__main__":
    sys.exit(main())
