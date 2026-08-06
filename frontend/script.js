(function () {
  const dropzone = document.getElementById("dropzone");
  const fileInput = document.getElementById("fileInput");
  const fileNameEl = document.getElementById("fileName");
  let selectedFile = null;

  fileInput.addEventListener("change", () => {
    selectedFile = fileInput.files[0] || null;
    fileNameEl.textContent = selectedFile ? selectedFile.name : "";
  });

  ["dragover", "dragenter"].forEach((ev) =>
    dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add("dragover"); })
  );
  ["dragleave", "drop"].forEach((ev) =>
    dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.remove("dragover"); })
  );
  dropzone.addEventListener("drop", (e) => {
    const f = e.dataTransfer.files[0];
    if (f) {
      selectedFile = f;
      fileInput.files = e.dataTransfer.files;
      fileNameEl.textContent = f.name;
    }
  });

  const pdbIdInput = document.getElementById("pdbIdInput");
  const exampleSelect = document.getElementById("exampleSelect");
  const phInput = document.getElementById("phInput");
  const cationicInput = document.getElementById("cationicInput");
  const chargeOverride = document.getElementById("chargeOverride");
  const volumeOverride = document.getElementById("volumeOverride");
  const multidomainInput = document.getElementById("multidomainInput");

  const analyzeBtn = document.getElementById("analyzeBtn");
  const errorMsg = document.getElementById("errorMsg");
  const loading = document.getElementById("loading");
  const inputCard = document.getElementById("inputCard");
  const resultCard = document.getElementById("resultCard");

  const regimeSectionLabel = document.getElementById("regimeSectionLabel");
  const regimeBadge = document.getElementById("regimeBadge");
  const regimeRoman = document.getElementById("regimeRoman");
  const regimeText = document.getElementById("regimeText");
  const regimeBlurb = document.getElementById("regimeBlurb");
  const resultProtein = document.getElementById("resultProtein");
  const descriptorGrid = document.getElementById("descriptorGrid");

  const API_BASE = window.ENCAGE_API_BASE || "";

  const REGIME_BLURBS = {
    I: "Compact and charge-matched — this cargo should load cleanly into the ferritin cavity.",
    II: "Bigger than the nominal cavity, but flexible multidomain proteins can still pack in. Worth testing, not guaranteed.",
    III: "Strongly cationic surface — this tends to clump with the cage instead of loading cleanly inside it.",
    NE: "Bigger than the nominal cavity and single-domain/rigid — adaptive packing isn't expected, so encapsulation is not predicted. " +
      "This outcome sits outside Regimes I–III: it is a prediction of the framework, not an experimentally characterised regime, and remains to be tested.",
  };
  const UNRESOLVED_BLURB =
    "Bigger than the nominal cavity — whether it loads depends on multidomain flexibility. " +
    "Set “Multidomain / flexible?” above and re-run to resolve.";

  // Regimes I-III are experimentally characterised and carry a numeral. Predicted
  // non-encapsulation (NE) deliberately does not — the manuscript frames it as
  // falling outside all three regimes rather than as a fourth regime.
  const REGIME_META = {
    I: { cls: "regime-1", roman: "I" },
    II: { cls: "regime-2", roman: "II" },
    III: { cls: "regime-3", roman: "III" },
    NE: { cls: "regime-ne", roman: "✕" },
  };
  const NUMBERED_REGIMES = ["I", "II", "III"];

  // Everything below is derived directly from real descriptor values and the
  // regime call itself — no fabricated confidence scores or loading estimates.
  const LOADING_BEHAVIOR = {
    I: ["Productive cage reassembly expected", "Minimal off-pathway aggregation expected"],
    II: ["Accommodation via adaptive packing is possible", "Outcome depends on conformational flexibility"],
    III: ["Off-pathway aggregation likely", "Reduced substrate/cage accessibility expected"],
    NE: ["Encapsulation via passive reassembly is not expected"],
  };
  const UNRESOLVED_LOADING = ["Outcome depends on multidomain flexibility, which is not yet specified"];

  const GUIDANCE_NOTES = {
    I: "Begin with standard loading conditions (pH cycling). No special precautions expected.",
    II: "Begin with standard loading conditions, but confirm conformational flexibility experimentally before scaling up.",
    III: "Consider reducing the cargo's net charge, or testing an alternative cage system, before proceeding.",
    NE: "Consider a smaller construct, a truncated/split domain, or a larger cage system.",
  };
  const UNRESOLVED_GUIDANCE = "Set “Multidomain / flexible?” above once known, and re-run to resolve the call.";

  let lastResult = null;

  function fmtSigned(val) {
    if (val === null || val === undefined) return "—";
    return (val > 0 ? "+" : "") + val;
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function showError(msg) {
    errorMsg.textContent = msg;
    errorMsg.classList.remove("hidden");
  }
  function clearError() {
    errorMsg.textContent = "";
    errorMsg.classList.add("hidden");
  }

  function fmt(val, unit) {
    if (val === null || val === undefined) return "—";
    return unit ? `${val} ${unit}` : `${val}`;
  }

  function renderResult(data) {
    lastResult = data;
    const notes = data.notes || [];
    const isNumbered = NUMBERED_REGIMES.includes(data.regime_number);
    const meta = REGIME_META[data.regime_number] || { cls: "regime-unresolved", roman: "?" };

    // ---- header ----
    const stamp = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    document.getElementById("reportId").textContent =
      `Analysis ID: ENCAGE_${stamp.getFullYear()}_${pad(stamp.getMonth() + 1)}_${pad(stamp.getDate())}_${data.protein}`;

    // ---- prediction summary ----
    if (regimeSectionLabel) regimeSectionLabel.textContent = isNumbered ? "Predicted regime" : "Predicted outcome";
    regimeBadge.className = `regime-badge ${meta.cls}`;
    regimeRoman.textContent = meta.roman;
    regimeText.textContent = data.regime_label;
    regimeBlurb.textContent = REGIME_BLURBS[data.regime_number] || UNRESOLVED_BLURB;
    resultProtein.textContent = data.protein;

    // Margin pill: reuses the backend's own tentative/cautionary/unresolved
    // language in its notes, rather than inventing a numeric confidence score.
    const isNearThreshold = /tentative|cautionary|close to|unresolved|specify multidomain/i.test(notes.join(" "));
    const marginPill = document.getElementById("reportMarginPill");
    marginPill.textContent = isNearThreshold ? "Near a threshold — see notes below" : "Clear-cut call";
    marginPill.className = `report-margin-pill ${isNearThreshold ? "caution" : "good"}`;

    // Checklist: three real comparisons against the actual thresholds used.
    const fitsCavity = data.dmax_nm !== null && data.dmax_nm <= 8.0;
    const chargeStatus = data.net_charge === null ? "unknown"
      : data.net_charge >= data.cationic_threshold ? "bad"
      : data.net_charge >= data.cationic_warn_low ? "caution" : "good";
    const compactShape = data.kappa2 !== null && data.kappa2 < 0.33;
    const checklist = [
      { ok: fitsCavity ? "good" : "bad", text: fitsCavity ? "Compact enough to fit the cavity" : `Exceeds the ~8 nm cavity (Dmax ${fmt(data.dmax_nm, "nm")})` },
      { ok: chargeStatus, text: chargeStatus === "good" ? "Charge is favourable" : chargeStatus === "caution" ? "Charge is in the cautionary band" : "Charge exceeds the cationic threshold" },
      { ok: compactShape ? "good" : "caution", text: compactShape ? "Compact, near-spherical shape" : `Elongated shape (κ² = ${fmt(data.kappa2)})` },
    ];
    document.getElementById("reportChecklist").innerHTML = checklist.map((c) =>
      `<li class="status-${c.ok}"><span class="status-dot"></span>${c.text}</li>`
    ).join("");

    // Expected loading behaviour — regime-tied, not a specific fabricated count.
    const loadingItems = data.multidomain === null && (data.regime_number === "II/NE (unresolved)")
      ? UNRESOLVED_LOADING
      : (LOADING_BEHAVIOR[data.regime_number] || UNRESOLVED_LOADING);
    document.getElementById("reportLoadingList").innerHTML = loadingItems.map((t) => `<li>${t}</li>`).join("");

    // ---- why this prediction ----
    const cavityPct = clamp((data.dmax_nm / 8.0) * 100, 0, 100);
    const cavityColor = data.dmax_nm <= 6 ? "var(--regime1)" : data.dmax_nm <= 8 ? "var(--regime2)" : "var(--regime3)";
    const cavityFill = document.getElementById("gaugeCavityFill");
    cavityFill.style.width = cavityPct + "%";
    cavityFill.style.background = cavityColor;
    document.getElementById("gaugeCavityMarker").style.left = cavityPct + "%";
    document.getElementById("statDmax").textContent = `${fmt(data.dmax_nm, "nm")} / 8.0 nm (${Math.round(cavityPct)}% of limit)`;
    document.getElementById("statVolRatio").textContent = data.volume_ratio !== null ? `${Math.round(data.volume_ratio * 100)}%` : "—";
    document.getElementById("statKappa").textContent = `${fmt(data.kappa2)} (${compactShape ? "compact" : "elongated"})`;
    const cavityNote = document.getElementById("cavityNote");
    if (data.dmax_nm <= 6) {
      cavityNote.textContent = "Sterically well within the ferritin cavity.";
      cavityNote.className = "why-note note-good";
    } else if (data.dmax_nm <= 8) {
      cavityNote.textContent = "Fits the cavity, but with limited spare room.";
      cavityNote.className = "why-note note-caution";
    } else {
      cavityNote.textContent = "Exceeds the nominal cavity diameter.";
      cavityNote.className = "why-note note-caution";
    }

    const chargeRange = Math.max(10, Math.ceil(Math.abs(data.net_charge || 0)) + 1);
    const chargePct = clamp(((data.net_charge + chargeRange) / (chargeRange * 2)) * 100, 0, 100);
    document.getElementById("gaugeChargeMarker").style.left = chargePct + "%";
    document.getElementById("statPh").textContent = fmt(data.ph);
    document.getElementById("statCharge").textContent = fmtSigned(data.net_charge);
    document.getElementById("statThreshold").textContent = fmtSigned(data.cationic_threshold);
    const chargeNote = document.getElementById("chargeNote");
    if (chargeStatus === "good") {
      chargeNote.textContent = "Comfortably below the cationic threshold.";
      chargeNote.className = "why-note note-good";
    } else if (chargeStatus === "caution") {
      chargeNote.textContent = "Slightly positive charge approaches the cationic threshold.";
      chargeNote.className = "why-note note-caution";
    } else {
      chargeNote.textContent = "Net charge is above the cationic threshold.";
      chargeNote.className = "why-note note-caution";
    }

    document.getElementById("overallRegimeBadge").className = `regime-badge ${meta.cls}`;
    document.getElementById("overallRegimeRoman").textContent = meta.roman;
    document.getElementById("overallRegimeText").textContent = data.regime_label;
    const overallList = [
      fitsCavity ? "No major steric limitations detected." : "Steric limitations are likely — oversized for the cavity.",
      chargeStatus === "good" ? "Charge is favourable." : chargeStatus === "caution" ? "Moderate charge caution." : "Charge is strongly unfavourable.",
    ];
    document.getElementById("overallList").innerHTML = overallList.map((t) => `<li>${t}</li>`).join("");

    // ---- experimental recommendations ----
    document.getElementById("recOutcome").textContent = REGIME_BLURBS[data.regime_number] || UNRESOLVED_BLURB;
    document.getElementById("recAssays").innerHTML = [
      "Size Exclusion Chromatography (SEC)",
      "Dynamic Light Scattering (DLS)",
      "Transmission Electron Microscopy (TEM)",
      "SDS-PAGE (loading analysis)",
    ].map((t) => `<li>${t}</li>`).join("");
    document.getElementById("recConcerns").textContent = notes.length ? notes.join(" ") : "No specific concerns flagged for this call.";
    document.getElementById("recNotes").textContent = GUIDANCE_NOTES[data.regime_number] || UNRESOLVED_GUIDANCE;

    // ---- threshold comparison charts (zones from the actual thresholds used) ----
    const dmaxMax = Math.max(10, Math.ceil(data.dmax_nm) + 1);
    const setZone = (id, leftPct, widthPct) => {
      const el = document.getElementById(id);
      el.style.left = leftPct + "%";
      el.style.width = widthPct + "%";
    };
    setZone("dmaxZoneGreen", 0, (6 / dmaxMax) * 100);
    setZone("dmaxZoneYellow", (6 / dmaxMax) * 100, ((8 - 6) / dmaxMax) * 100);
    setZone("dmaxZoneRed", (8 / dmaxMax) * 100, ((dmaxMax - 8) / dmaxMax) * 100);
    const dmaxMarkerPct = clamp((data.dmax_nm / dmaxMax) * 100, 0, 100);
    document.getElementById("dmaxMarker").style.left = dmaxMarkerPct + "%";
    document.getElementById("dmaxMarkerValue").textContent = `${fmt(data.dmax_nm, "nm")} — Your protein`;
    document.getElementById("dmaxAxisMax").textContent = `${dmaxMax.toFixed(1)} nm`;

    const cR = chargeRange;
    const warnPct = ((data.cationic_warn_low + cR) / (cR * 2)) * 100;
    const threshPct = ((data.cationic_threshold + cR) / (cR * 2)) * 100;
    setZone("chargeZoneGreen", 0, warnPct);
    setZone("chargeZoneYellow", warnPct, threshPct - warnPct);
    setZone("chargeZoneRed", threshPct, 100 - threshPct);
    document.getElementById("chargeMarker").style.left = chargePct + "%";
    document.getElementById("chargeMarkerValue").textContent = `${fmtSigned(data.net_charge)} — Your protein`;
    document.getElementById("chargeAxisPh").textContent = fmt(data.ph);
    document.getElementById("chargeAxisMin").textContent = -cR;
    document.getElementById("chargeAxisMax").textContent = "+" + cR;

    // ---- scientific summary ----
    document.getElementById("scientificSummary").textContent =
      `${data.protein} is predicted to follow ${isNumbered ? "Regime " + data.regime_number : data.regime_label.toLowerCase()}` +
      ` (${data.regime_label.toLowerCase()}). Steric compatibility is ${fitsCavity ? "favourable" : "unfavourable"}, with a Dmax of ` +
      `${fmt(data.dmax_nm, "nm")}${data.volume_ratio !== null ? ` and a volume ratio of ${fmt(data.volume_ratio)}` : ""} against the ~8.0 nm cavity limit. ` +
      `The net charge of ${fmtSigned(data.net_charge)} is ${chargeStatus === "good" ? "comfortably below" : chargeStatus === "caution" ? "close to" : "above"} ` +
      `the cationic threshold of ${fmtSigned(data.cationic_threshold)}.`;
    document.getElementById("infoProtein").textContent = data.protein;
    document.getElementById("infoMW").textContent = data.molecular_weight_kda !== null && data.molecular_weight_kda !== undefined
      ? `${data.molecular_weight_kda} kDa` : "—";
    document.getElementById("infoPh").textContent = fmt(data.ph);

    // ---- advanced descriptors ----
    const items = [
      ["Dmax", fmt(data.dmax_nm, "nm"), "~8.0 nm cavity diameter", null],
      ["Length × width × thickness", `${fmt(data.length_nm)} × ${fmt(data.width_nm)} × ${fmt(data.thickness_nm)} nm`, "—", null],
      ["Volume ratio", fmt(data.volume_ratio), "1.00 = full cavity", data.volume_source],
      ["Molecular volume", fmt(data.volume_nm3, "nm³"), "268 nm³ cavity", data.volume_source],
      ["Molecular weight", data.molecular_weight_kda !== null && data.molecular_weight_kda !== undefined ? `${data.molecular_weight_kda} kDa` : "—", "from sequence", null],
      ["Net charge (pH " + fmt(data.ph) + ")", fmt(data.net_charge), `cationic threshold ${fmt(data.cationic_threshold)}`, data.charge_source],
      ["Shape anisotropy (κ²)", fmt(data.kappa2), "0 = sphere, 1 = rod", null],
    ];
    if (data.dmax_nm > 8.0) {
      const mdLabel = data.multidomain === true ? "Yes" : data.multidomain === false ? "No" : "Not specified";
      items.push(["Multidomain / flexible", mdLabel, "consulted only when oversized", null]);
    }

    descriptorGrid.innerHTML = items.map(([label, value, ref, source]) => `
      <tr>
        <td data-label="Descriptor">${label}</td>
        <td class="value" data-label="Value">${value}${source ? `<span class="source">${source}</span>` : ""}</td>
        <td class="ref" data-label="Cavity reference">${ref}</td>
      </tr>
    `).join("");

    resultCard.classList.remove("hidden");
    resultCard.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // The three input columns (upload / PDB ID / example) are all visible at
  // once now, rather than tabs — so priority order decides which one wins
  // if more than one is filled in: an uploaded file beats a typed ID, which
  // beats a chosen example.
  async function runAnalysis(pdbIdOverride) {
    clearError();

    const form = new FormData();
    if (pdbIdOverride) {
      form.append("pdb_id", pdbIdOverride);
    } else if (selectedFile) {
      form.append("pdb_file", selectedFile);
    } else if (pdbIdInput.value.trim()) {
      const id = pdbIdInput.value.trim();
      if (!/^[A-Za-z0-9]{4}$/.test(id)) { showError("Enter a valid 4-character PDB ID, e.g. 4CHA."); return; }
      form.append("pdb_id", id);
    } else if (exampleSelect.value) {
      form.append("pdb_id", exampleSelect.value);
    } else {
      showError("Choose a file, enter a PDB ID, or pick an example above.");
      return;
    }
    if (phInput.value) form.append("ph", phInput.value);
    if (cationicInput.value) form.append("cationic_threshold", cationicInput.value);
    if (chargeOverride.value) form.append("net_charge", chargeOverride.value);
    if (volumeOverride.value) form.append("ses_volume_a3", volumeOverride.value);
    if (multidomainInput.value) form.append("multidomain", multidomainInput.value);

    analyzeBtn.disabled = true;
    loading.classList.remove("hidden");

    try {
      const res = await fetch(`${API_BASE}/api/analyze`, { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        showError(data.error || "Something went wrong.");
      } else {
        renderResult(data);
      }
    } catch (e) {
      showError("Network error — please check your connection and try again.");
    } finally {
      analyzeBtn.disabled = false;
      loading.classList.add("hidden");
    }
  }

  analyzeBtn.addEventListener("click", () => runAnalysis());

  // Picking an example pre-fills its known multidomain flag (so Advanced
  // settings shows the right default if opened) without auto-running —
  // the user still presses the shared Run button below.
  exampleSelect.addEventListener("change", () => {
    if (!exampleSelect.value) return;
    const opt = exampleSelect.selectedOptions[0];
    multidomainInput.value = (opt && opt.dataset.multidomain) || "";
  });

  // Deep link from the About > Examples page ("Run this example"): if
  // ?example=4CHA matches one of the dropdown's options, pre-select it (same
  // as picking it by hand) and scroll to the tool — still requires pressing
  // Run, consistent with the dropdown's own no-auto-run behaviour.
  (function preselectExampleFromQuery() {
    const requested = new URLSearchParams(location.search).get("example");
    if (!requested) return;
    const match = [...exampleSelect.options].find((o) => o.value.toUpperCase() === requested.toUpperCase());
    if (!match) return;
    exampleSelect.value = match.value;
    exampleSelect.dispatchEvent(new Event("change"));
    inputCard.scrollIntoView({ behavior: "smooth", block: "start" });
  })();

  document.getElementById("resetBtn").addEventListener("click", () => {
    resultCard.classList.add("hidden");
    selectedFile = null;
    fileInput.value = "";
    fileNameEl.textContent = "";
    pdbIdInput.value = "";
    exampleSelect.value = "";
    multidomainInput.value = "";
    clearError();
    inputCard.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  function downloadCsv() {
    if (!lastResult) return;
    const d = lastResult;
    const rows = [
      ["Protein", d.protein],
      ["Length (nm)", d.length_nm],
      ["Width (nm)", d.width_nm],
      ["Thickness (nm)", d.thickness_nm],
      ["Dmax (nm)", d.dmax_nm],
      ["Volume (nm3)", d.volume_nm3],
      ["Volume ratio", d.volume_ratio],
      ["Volume source", d.volume_source],
      ["Molecular weight (kDa)", d.molecular_weight_kda],
      [`Net charge (pH ${d.ph})`, d.net_charge],
      ["Charge source", d.charge_source],
      ["Relative shape anisotropy", d.kappa2],
      ["Multidomain flag", d.multidomain === null || d.multidomain === undefined ? "not specified" : d.multidomain],
      [
        NUMBERED_REGIMES.includes(d.regime_number) ? "Predicted regime" : "Predicted outcome",
        `${d.regime_number} (${d.regime_label})`,
      ],
      ["Notes", (d.notes || []).join("; ")],
    ];
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `enCAGE_${d.protein}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  document.getElementById("downloadBtn").addEventListener("click", downloadCsv);
  document.getElementById("downloadBtnTop").addEventListener("click", downloadCsv);
})();
