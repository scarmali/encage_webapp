(function () {
  var TITLES = {
    overview: "Overview — About enCAGE",
    results: "Understanding Results — About enCAGE",
    descriptors: "Descriptors — About enCAGE",
    methods: "Methods — About enCAGE",
    examples: "Examples — About enCAGE",
  };
  var VALID = Object.keys(TITLES);
  var navItems = document.querySelectorAll(".about-nav-item");
  var sections = document.querySelectorAll(".about-section");

  function showSection(id, opts) {
    opts = opts || {};
    if (VALID.indexOf(id) === -1) id = "overview";
    navItems.forEach(function (item) {
      var active = item.dataset.section === id;
      item.classList.toggle("active", active);
      if (active) item.setAttribute("aria-current", "page");
      else item.removeAttribute("aria-current");
    });
    sections.forEach(function (section) {
      section.classList.toggle("hidden", section.id !== "section-" + id);
    });
    document.title = TITLES[id];
    if (opts.scroll !== false) window.scrollTo({ top: 0, behavior: "auto" });
  }

  // Anything with a data-section attribute can jump to a section — the
  // sidebar nav items, plus one-off links like the "Explore examples" CTA
  // at the bottom of Overview. Only .about-nav-item gets the active-state
  // highlight, handled inside showSection.
  document.querySelectorAll("[data-section]").forEach(function (item) {
    item.addEventListener("click", function () {
      var id = item.dataset.section;
      showSection(id);
      history.pushState(null, "", "#" + id);
    });
  });

  window.addEventListener("popstate", function () {
    showSection((location.hash || "").replace("#", ""), { scroll: false });
  });

  // In-page anchors that point at a spot within the current section (e.g. the
  // "jump to this descriptor" links) rather than at a section itself — scroll
  // manually instead of letting the browser touch location.hash, since a hash
  // change here can be picked up by the popstate handler above and mistaken
  // for a section id, resetting the view back to Overview.
  document.querySelectorAll('a[href^="#"]').forEach(function (link) {
    var targetId = link.getAttribute("href").slice(1);
    if (!targetId || VALID.indexOf(targetId) !== -1) return;
    link.addEventListener("click", function (e) {
      var target = document.getElementById(targetId);
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  showSection((location.hash || "").replace("#", ""), { scroll: false });

  // Report which encage_core the backend is actually running. The frontend is
  // static and the version lives in Python, so it has to be fetched. Kept quiet
  // on failure: an unreachable backend shouldn't put an error in the footer.
  var versionEl = document.getElementById("footerVersion");
  if (versionEl && window.fetch) {
    var apiBase = window.ENCAGE_API_BASE || "";
    fetch(apiBase + "/api/health")
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (d && d.encage_core_version) {
          versionEl.textContent = "enCAGE core v" + d.encage_core_version;
          versionEl.hidden = false;
        }
      })
      .catch(function () { /* offline or backend asleep - stay hidden */ });
  }
})();
