// Scrollspy: highlights the nav link for whichever section is
// currently centered in the viewport. Vanilla JS, no dependencies.
document.addEventListener("DOMContentLoaded", function () {
  var links = Array.prototype.slice.call(
    document.querySelectorAll(".main-nav a.nav-link[href^='#']")
  );
  if (links.length === 0 || !("IntersectionObserver" in window)) return;

  var sections = links
    .map(function (link) {
      return document.getElementById(link.getAttribute("href").slice(1));
    })
    .filter(Boolean);

  if (sections.length === 0) return;

  var observer = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var link = links.filter(function (l) {
          return l.getAttribute("href") === "#" + entry.target.id;
        })[0];
        if (!link) return;
        links.forEach(function (l) { l.classList.remove("active"); });
        link.classList.add("active");
      });
    },
    { rootMargin: "-45% 0px -45% 0px", threshold: 0 }
  );

  sections.forEach(function (section) { observer.observe(section); });
});
