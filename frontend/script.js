(function () {
  // API_BASE is set in config.js (window.ENCAGE_API_BASE), so the same static
  // frontend can be pointed at a local dev server or a deployed Render/Railway
  // backend without editing this file.
  const API_BASE = (window.ENCAGE_API_BASE || "").replace(/\/$/, "");

  const tabs = document.querySelectorAll(".tab");
  const panelUpload = document.getElementById("panel-upload");
  const panelFetch = document.getElementById("panel-fetch");

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => { t.classList.remove("active"); t.setAttribute("aria-selected", "false"); });
      tab.classList.add("active");
      tab.setAttribute("aria-selected", "true");
      const which = tab.dataset.tab;
      panelUpload.classList.toggle("hidden", which !== "upload");
      panelFetch.classList.toggle("hidden", which !== "fetch");
    });
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

  const analyzeBtn = document.getElementById("analyzeBtn");
  const errorMsg = document.getElementById("errorMsg");
  const loading = document.getElementById("loading");
  const inputCard = document.querySelector(".input-card");
  const resultCard = document.getElementById("resultCard");

  const regimeBadge = document.getElementById("regimeBadge");
  const regimeRoman = document.getElementById("regimeRoman");
  const regimeText = document.getElementById("regimeText");
  const resultProtein = document.getElementById("resultProtein");
  const descriptorGrid = document.getElementById("descriptorGrid");
  const notesBlock = document.getElementById("notesBlock");

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

    const regimeClass = { I: "regime-1", II: "regime-2", III: "regime-3" }[data.regime_number] || "regime-1";
    regimeBadge.className = `regime-badge ${regimeClass}`;
    regimeRoman.textContent = data.regime_number;
    regimeText.textContent = data.regime_label;
    resultProtein.textContent = data.protein;

    const items = [
      ["Dmax", fmt(data.dmax_nm, "nm"), null],
      ["Length × Width × Thickness", `${fmt(data.length_nm)} × ${fmt(data.width_nm)} × ${fmt(data.thickness_nm)} nm`, null],
      ["Volume ratio (vs 268 nm³ cavity)", fmt(data.volume_ratio), data.volume_source],
      ["SES / grid volume", fmt(data.volume_nm3, "nm³"), data.volume_source],
      ["Net charge (pH " + fmt(data.ph) + ")", fmt(data.net_charge), data.charge_source],
      ["Relative shape anisotropy (κ²)", fmt(data.kappa2), null],
    ];

    descriptorGrid.innerHTML = items.map(([label, value, source]) => `
      <div class="descriptor-item">
        <span class="label">${label}</span>
        <span class="value">${value}</span>
        ${source ? `<span class="source">${source}</span>` : ""}
      </div>
    `).join("");

    if (data.notes && data.notes.length) {
      notesBlock.innerHTML = `<ul>${data.notes.map((n) => `<li>${n}</li>`).join("")}</ul>`;
    } else {
      notesBlock.innerHTML = `<p class="notes-empty">No caveats flagged for this call.</p>`;
    }

    inputCard.classList.add("hidden");
    resultCard.classList.remove("hidden");
    resultCard.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  analyzeBtn.addEventListener("click", async () => {
    clearError();

    if (!API_BASE || API_BASE.includes("YOUR-BACKEND-NAME")) {
      showError("Set window.ENCAGE_API_BASE in config.js to your deployed backend URL first.");
      return;
    }

    const activeTab = document.querySelector(".tab.active").dataset.tab;

    const form = new FormData();
    if (activeTab === "upload") {
      if (!selectedFile) { showError("Please choose a .pdb file first."); return; }
      form.append("pdb_file", selectedFile);
    } else {
      const id = pdbIdInput.value.trim();
      if (!/^[A-Za-z0-9]{4}$/.test(id)) { showError("Enter a valid 4-character PDB ID, e.g. 4CHA."); return; }
      form.append("pdb_id", id);
    }
    if (phInput.value) form.append("ph", phInput.value);
    if (cationicInput.value) form.append("cationic_threshold", cationicInput.value);
    if (chargeOverride.value) form.append("net_charge", chargeOverride.value);
    if (volumeOverride.value) form.append("ses_volume_a3", volumeOverride.value);

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
      showError("Network error — please check your connection and that the backend URL in config.js is correct.");
    } finally {
      analyzeBtn.disabled = false;
      loading.classList.add("hidden");
    }
  });

  document.getElementById("resetBtn").addEventListener("click", () => {
    resultCard.classList.add("hidden");
    inputCard.classList.remove("hidden");
    selectedFile = null;
    fileInput.value = "";
    fileNameEl.textContent = "";
    pdbIdInput.value = "";
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
