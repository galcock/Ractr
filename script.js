// Mobile nav toggle
const nav = document.querySelector(".nav");
const navToggle = document.querySelector(".nav-toggle");

if (nav && navToggle) {
  navToggle.addEventListener("click", () => {
    nav.classList.toggle("open");
  });
}

// Solutions dropdown
const dropdown = document.querySelector(".nav-dropdown");
if (dropdown) {
  const button = dropdown.querySelector(".nav-link-button");
  button.addEventListener("click", () => {
    dropdown.classList.toggle("open");
  });

  document.addEventListener("click", (e) => {
    if (!dropdown.contains(e.target)) {
      dropdown.classList.remove("open");
    }
  });
}

// Smooth scroll helpers
document.querySelectorAll("[data-scroll]").forEach((btn) => {
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    const targetSel = btn.getAttribute("data-scroll");
    const target = document.querySelector(targetSel);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });
});

document.querySelectorAll('a[href^="#"]').forEach((link) => {
  link.addEventListener("click", (e) => {
    const href = link.getAttribute("href");
    if (!href || href === "#" || href.length === 1) return;
    const target = document.querySelector(href);
    if (!target) return;
    e.preventDefault();
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  });
});

// Community filter chips
const filterChips = document.querySelectorAll(".filter-chip");
const communityCards = document.querySelectorAll(".community-card");

function applyFilter(filter) {
  communityCards.forEach((card) => {
    const tags = (card.getAttribute("data-tags") || "").split(/\s+/);
    const visible = filter === "all" || tags.includes(filter);
    card.style.display = visible ? "" : "none";
  });
}

filterChips.forEach((chip) => {
  chip.addEventListener("click", () => {
    const filter = chip.getAttribute("data-filter") || "all";
    filterChips.forEach((c) => c.classList.remove("filter-chip-active"));
    chip.classList.add("filter-chip-active");
    applyFilter(filter);
  });
});

// Initial filter
applyFilter("all");

// Footer year
const yearEl = document.getElementById("year");
if (yearEl) {
  yearEl.textContent = new Date().getFullYear();
}
