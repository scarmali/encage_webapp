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

  navItems.forEach(function (item) {
    item.addEventListener("click", function () {
      var id = item.dataset.section;
      showSection(id);
      history.pushState(null, "", "#" + id);
    });
  });

  window.addEventListener("popstate", function () {
    showSection((location.hash || "").replace("#", ""), { scroll: false });
  });

  showSection((location.hash || "").replace("#", ""), { scroll: false });
})();
