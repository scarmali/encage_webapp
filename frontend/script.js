(function () {
  const options = document.querySelectorAll(".input-option");
  const panelUpload = document.getElementById("panel-upload");
  const panelFetch = document.getElementById("panel-fetch");
  const panelExample = document.getElementById("panel-example");

  function selectOption(which) {
    options.forEach((o) => {
      const active = o.dataset.option === which;
      o.classList.toggle("active", active);
      o.setAttribute("aria-selected", active ? "true" : "false");
    });
    panelUpload.classList.toggle("hidden", which !== "upload");
    panelFetch.classList.toggle("hidden", which !== "fetch");
    panelExample.classList.toggle("hidden", which !== "example");
  }

  options.forEach((option) => {
    option.addEventListener("click", () => selectOption(option.dataset.option));
  });

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
  const phInput = document.getElementById("phInput");
  const cationicInput = document.getElementById("cationicInput");
  const chargeOverride = document.getElementById("chargeOverride");
  const volumeOverride = document.getElementById("volumeOverride");
  const multidomainInput = document.getElementById("multidomainInput");

  const analyzeBtn = document.getElementById("analyzeBtn");
  const errorMsg = document.getElementById("errorMsg");
  const loading = document.getElementById("loading");
  const inputCard = document.querySelector(".input-card");
  const resultCard = document.getElementById("resultCard");

  const regimeBadge = document.getElementById("regimeBadge");
  const regimeRoman = document.getElementById("regimeRoman");
  const regimeText = document.getElementById("regimeText");
  const regimeBlurb = document.getElementById("regimeBlurb");
  const resultProtein = document.getElementById("resultProtein");
  const descriptorGrid = document.getElementById("descriptorGrid");
  const notesBlock = document.getElementById("notesBlock");

  const API_BASE = window.ENCAGE_API_BASE || "";

  const REGIME_BLURBS = {
    I: "Compact and charge-matched — this cargo should load cleanly into the ferritin cavity.",
    II: "Bigger than the nominal cavity, but flexible multidomain proteins can still pack in. Worth testing, not guaranteed.",
    III: "Strongly cationic surface — this tends to clump with the cage instead of loading cleanly inside it.",
    IV: "Bigger than the nominal cavity and single-domain/rigid — adaptive packing isn't expected, so encapsulation is not predicted.",
  };
  const UNRESOLVED_BLURB =
    "Bigger than the nominal cavity — whether it loads depends on multidomain flexibility. " +
    "Set “Multidomain / flexible?” above and re-run to resolve.";

  const REGIME_META = {
    I: { cls: "regime-1", roman: "I" },
    II: { cls: "regime-2", roman: "II" },
    III: { cls: "regime-3", roman: "III" },
    IV: { cls: "regime-4", roman: "IV" },
  };

  let lastResult = null;

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

    const meta = REGIME_META[data.regime_number] || { cls: "regime-unresolved", roman: "?" };
    regimeBadge.className = `regime-badge ${meta.cls}`;
    regimeRoman.textContent = meta.roman;
    regimeText.textContent = data.regime_label;
    regimeBlurb.textContent = REGIME_BLURBS[data.regime_number] || UNRESOLVED_BLURB;
    resultProtein.textContent = data.protein;

    const items = [
      ["Dmax", fmt(data.dmax_nm, "nm"), "~8.0 nm cavity diameter", null],
      ["Length × width × thickness", `${fmt(data.length_nm)} × ${fmt(data.width_nm)} × ${fmt(data.thickness_nm)} nm`, "—", null],
      ["Volume ratio", fmt(data.volume_ratio), "1.00 = full cavity", data.volume_source],
      ["Molecular volume", fmt(data.volume_nm3, "nm³"), "268 nm³ cavity", data.volume_source],
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

    if (data.notes && data.notes.length) {
      notesBlock.innerHTML = `<ul>${data.notes.map((n) => `<li>${n}</li>`).join("")}</ul>`;
    } else {
      notesBlock.innerHTML = `<p class="notes-empty">No caveats flagged for this call.</p>`;
    }

    resultCard.classList.remove("is-empty");
    resultCard.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function runAnalysis(pdbIdOverride) {
    clearError();
    const activeOption = document.querySelector(".input-option.active").dataset.option;

    const form = new FormData();
    if (pdbIdOverride) {
      form.append("pdb_id", pdbIdOverride);
    } else if (activeOption === "upload") {
      if (!selectedFile) { showError("Please choose a .pdb file first."); return; }
      form.append("pdb_file", selectedFile);
    } else if (activeOption === "fetch") {
      const id = pdbIdInput.value.trim();
      if (!/^[A-Za-z0-9]{4}$/.test(id)) { showError("Enter a valid 4-character PDB ID, e.g. 4CHA."); return; }
      form.append("pdb_id", id);
    } else {
      showError("Select an example protein above, or switch to Upload / Enter PDB ID.");
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

  document.querySelectorAll(".example-item").forEach((item) => {
    item.addEventListener("click", () => {
      selectOption("fetch");
      pdbIdInput.value = item.dataset.pdb;
      multidomainInput.value = item.dataset.multidomain || "";
      runAnalysis(item.dataset.pdb);
    });
  });

  const tryExampleLink = document.getElementById("tryExampleLink");
  if (tryExampleLink) {
    tryExampleLink.addEventListener("click", (e) => {
      e.preventDefault();
      selectOption("example");
      inputCard.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  document.getElementById("resetBtn").addEventListener("click", () => {
    resultCard.classList.add("is-empty");
    selectedFile = null;
    fileInput.value = "";
    fileNameEl.textContent = "";
    pdbIdInput.value = "";
    multidomainInput.value = "";
    selectOption("upload");
    clearError();
    inputCard.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  document.getElementById("downloadBtn").addEventListener("click", () => {
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
      [`Net charge (pH ${d.ph})`, d.net_charge],
      ["Charge source", d.charge_source],
      ["Relative shape anisotropy", d.kappa2],
      ["Multidomain flag", d.multidomain === null || d.multidomain === undefined ? "not specified" : d.multidomain],
      ["Predicted regime", `${d.regime_number} (${d.regime_label})`],
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
  });
})();
