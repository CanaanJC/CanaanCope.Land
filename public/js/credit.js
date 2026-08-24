console.log("Credit module loaded");

if (window.location.pathname !== "/") {
    throw new Error("[credit.js] Not the homepage, halting module.");
}

const SETTLE_DELAY_MS = 300;

function buildCredit() {
    const link = document.createElement("a");
    link.id = "site-credit";
    link.className = "site-credit";
    link.href = "https://canaancope.land/";
    link.target = "_blank";
    link.rel = "noopener noreferrer";

    const img = document.createElement("img");
    img.className = "site-credit__icon";
    img.src = "https://canaancope.land/media/logo.png";
    img.alt = "Canaan Copeland";
    img.loading = "lazy";

    const text = document.createElement("span");
    text.className = "site-credit__text";
    text.textContent = "Site designed by Canaan Copeland";

    link.appendChild(img);
    link.appendChild(text);
    return link;
}

// about-me.js and featured.js both append their content asynchronously and
// in no guaranteed order relative to each other. Rather than eagerly
// inserting the credit line and repositioning it on every single mutation
// (which caused a visible multi-step "jump" as content streamed in), this
// waits for a quiet period (no DOM changes for SETTLE_DELAY_MS) before
// placing it once, at the bottom, after everything else has finished.
function insertCreditWhenSettled() {
    const container = document.getElementById("content");
    if (!container) return;

    let credit = null;
    let settleTimer = null;

    const place = () => {
        if (!credit) credit = buildCredit();
        if (container.lastElementChild !== credit) {
            container.appendChild(credit); // re-appending an existing node moves it
        }
    };

    const scheduleSettle = () => {
        if (settleTimer) clearTimeout(settleTimer);
        settleTimer = setTimeout(place, SETTLE_DELAY_MS);
    };

    const observer = new MutationObserver(() => {
        scheduleSettle();
    });
    observer.observe(container, { childList: true });

    // In case neither about-me.js nor featured.js ever mutates the container
    // (e.g. both fail/are empty), still place the credit after the settle
    // window so the page isn't left without it.
    scheduleSettle();
}

document.addEventListener("DOMContentLoaded", insertCreditWhenSettled);
