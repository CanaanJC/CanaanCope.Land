console.log("404 page module loaded");

const NOTIFY_URL   = "/config/notify.json";
const IP_LOOKUP_URL = "https://ipapi.co/json/";

const media    = document.getElementById("notfound-media");
const image    = document.getElementById("notfound-image");
const video    = document.getElementById("notfound-video");
const playBtn  = document.getElementById("notfound-play-dino");
const fixBtn   = document.getElementById("notfound-fix");

let discordWebhookUrl = "";

async function loadNotifyConfig() {
    try {
        const res = await fetch(`${NOTIFY_URL}?_=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`notify.json HTTP ${res.status}`);
        const data = await res.json();
        discordWebhookUrl = data.discordWebhookUrl || "";
    } catch (err) {
        console.error("404: failed to load notify config:", err);
    }
}
loadNotifyConfig();

// ── Best-effort UA parsing (rough — good enough for a quick human read) ──────

function parseOS(ua) {
    if (/Windows NT 10/.test(ua)) return "Windows 10/11";
    if (/Windows NT/.test(ua)) return "Windows (older)";
    if (/Mac OS X/.test(ua)) return "macOS";
    if (/Android/.test(ua)) return "Android";
    if (/iPhone|iPad|iPod/.test(ua)) return "iOS";
    if (/Linux/.test(ua)) return "Linux";
    return "Unknown OS";
}

function parseBrowser(ua) {
    if (/Edg\//.test(ua)) return "Edge";
    if (/OPR\//.test(ua)) return "Opera";
    if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) return "Chrome";
    if (/Firefox\//.test(ua)) return "Firefox";
    if (/Safari\//.test(ua) && !/Chrome/.test(ua)) return "Safari";
    return "Unknown Browser";
}

// ── Collect everything the browser will hand over ────────────────────────────

async function collectVisitorInfo() {
    const ua = navigator.userAgent || "unknown";

    let ipInfo = {};
    try {
        const res = await fetch(IP_LOOKUP_URL);
        if (res.ok) ipInfo = await res.json();
    } catch (err) {
        console.error("404: IP lookup failed:", err);
    }

    return {
        ip:          ipInfo.ip || "unknown",
        city:        ipInfo.city || "?",
        region:      ipInfo.region || "?",
        country:     ipInfo.country_name || "?",
        org:         ipInfo.org || "?",
        userAgent:   ua,
        os:          parseOS(ua),
        browser:     parseBrowser(ua),
        platform:    navigator.platform || "unknown",
        screen:      `${screen.width}x${screen.height} @${window.devicePixelRatio || 1}x`,
        viewport:    `${window.innerWidth}x${window.innerHeight}`,
        language:    navigator.language || "unknown",
        languages:   (navigator.languages || []).join(", "),
        timezone:    Intl.DateTimeFormat().resolvedOptions().timeZone || "unknown",
        cores:       navigator.hardwareConcurrency || "unknown",
        memory:      navigator.deviceMemory ? `${navigator.deviceMemory} GB` : "unknown",
        connection:  navigator.connection?.effectiveType || "unknown",
        referrer:    document.referrer || "(direct / none)",
        cookiesOn:   navigator.cookieEnabled,
        isAutomated: navigator.webdriver === true, // best crawler/bot signal
    };
}

// ── Video preloaded hidden from page load (preload="auto" in the HTML) so by
// the time the user clicks "Fix the Issue" it can start playing instantly,
// full volume, with zero buffering delay. Calling .play() synchronously
// inside a click handler is a user gesture, so browsers allow unmuted
// autoplay here (unlike a page-load autoplay, which would be blocked). ──────

let dinoActive = false;

function showDinoGame() {
    if (dinoActive) return;
    dinoActive = true;

    video.pause();
    video.hidden = true;
    image.hidden = true;

    const iframe = document.createElement("iframe");
    iframe.src = "https://chromedino.com/embed/";
    iframe.frameBorder = "0";
    iframe.scrolling = "no";
    iframe.width = "100%";
    iframe.height = "100%";
    iframe.loading = "lazy";
    iframe.id = "notfound-dino-iframe";
    media.appendChild(iframe);
}

async function notifyDiscord() {
    if (!discordWebhookUrl) return; // empty until master.json sets one

    const attemptedUrl = window.location.href;
    const info = await collectVisitorInfo();

    const payload = {
        embeds: [
            {
                title: "Rick Roll activated",
                description: `**URL attempted:**\n${attemptedUrl}`,
                color: info.isAutomated ? 0xff0000 : 0xffa500,
                fields: [
                    { name: "IP",           value: info.ip,                    inline: true },
                    { name: "Location",     value: `${info.city}, ${info.region}, ${info.country}`, inline: true },
                    { name: "ISP/Org",      value: info.org,                   inline: false },
                    { name: "OS",           value: info.os,                    inline: true },
                    { name: "Browser",      value: info.browser,               inline: true },
                    { name: "Platform",     value: info.platform,              inline: true },
                    { name: "Screen",       value: info.screen,                inline: true },
                    { name: "Viewport",     value: info.viewport,              inline: true },
                    { name: "Language(s)",  value: info.languages || info.language, inline: true },
                    { name: "Timezone",     value: info.timezone,              inline: true },
                    { name: "CPU Cores",    value: String(info.cores),         inline: true },
                    { name: "Device Memory",value: info.memory,                inline: true },
                    { name: "Connection",   value: info.connection,            inline: true },
                    { name: "Cookies On",   value: String(info.cookiesOn),     inline: true },
                    { name: "⚠️ Automated Browser (bot flag)", value: String(info.isAutomated), inline: true },
                    { name: "Referrer",     value: info.referrer,              inline: false },
                    { name: "Full User Agent", value: info.userAgent.slice(0, 1000), inline: false },
                ],
                timestamp: new Date().toISOString(),
            },
        ],
    };

    fetch(discordWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    }).catch(err => console.error("404: failed to notify Discord webhook:", err));
}

function showFixVideo() {
    dinoActive = false;

    const iframe = document.getElementById("notfound-dino-iframe");
    if (iframe) iframe.remove();

    notifyDiscord();

    image.hidden = true;
    video.hidden = false;
    video.muted = false;
    video.currentTime = 0;
    video.play().catch(() => {
        // Extremely defensive fallback — if the browser still refuses
        // unmuted playback for some reason, retry muted so it at least plays.
        video.muted = true;
        video.play().catch(() => {});
    });
}

playBtn.addEventListener("click", showDinoGame);
fixBtn.addEventListener("click", showFixVideo);
