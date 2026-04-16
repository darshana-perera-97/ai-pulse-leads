const http = require("http");
const https = require("https");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const whatsappThrottle = require("./whatsappSendThrottle");

function loadDotEnv() {
    const envPath = path.join(__dirname, ".env");
    if (!fs.existsSync(envPath)) return;

    const content = fs.readFileSync(envPath, "utf8");
    const lines = content.split(/\r?\n/);

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;
        if (line.startsWith("#")) continue;

        const idx = line.indexOf("=");
        if (idx === -1) continue;

        const key = line.slice(0, idx).trim();
        let value = line.slice(idx + 1).trim();

        // Strip surrounding quotes: KEY="value" / KEY='value'
        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }

        if (key) process.env[key] = value;
    }
}

loadDotEnv();

function httpLogMode() {
    const m = String(process.env.BACKEND_HTTP_LOG ?? "1").trim().toLowerCase();
    if (m === "0" || m === "off" || m === "false") return "off";
    if (m === "full" || m === "all") return "full";
    return "default";
}

const HTTP_LOG_QUIET_PATHS = new Set(
    String(
        process.env.BACKEND_HTTP_LOG_QUIET_PATHS ??
            "/whatsapp/status,/health"
    )
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
);

/**
 * @param {{ apiKey: string, q: string, gl: string, page: number }} opts
 * @returns {Promise<{ status: number, data: unknown }>}
 */
function serperPlacesRequest({ apiKey, q, gl, page }) {
    const payload = JSON.stringify({ q, gl, page });
    return new Promise((resolve, reject) => {
        const req = https.request(
            {
                hostname: "google.serper.dev",
                path: "/places",
                method: "POST",
                headers: {
                    "X-API-KEY": apiKey,
                    "Content-Type": "application/json",
                    "Content-Length": Buffer.byteLength(payload),
                },
            },
            (incoming) => {
                let raw = "";
                incoming.on("data", (chunk) => {
                    raw += String(chunk);
                });
                incoming.on("end", () => {
                    let data = null;
                    try {
                        data = raw.trim() ? JSON.parse(raw) : {};
                    } catch {
                        data = { _parseError: true, raw };
                    }
                    resolve({ status: incoming.statusCode || 0, data });
                });
            }
        );
        req.on("error", reject);
        req.write(payload);
        req.end();
    });
}

/**
 * @param {unknown} place
 */
function pickEmailFromPlace(place) {
    if (!place || typeof place !== "object") return "";
    const p = /** @type {Record<string, unknown>} */ (place);
    if (typeof p.email === "string" && p.email.trim()) return p.email.trim();

    const ext = p.extensions;
    if (Array.isArray(ext)) {
        for (const item of ext) {
            const s = String(item);
            const m = s.match(/[\w.+-]+@[\w.-]+\.[\w.-]+/);
            if (m) return m[0];
        }
    }
    const snippet = typeof p.snippet === "string" ? p.snippet : "";
    if (snippet) {
        const m = snippet.match(/[\w.+-]+@[\w.-]+\.[\w.-]+/);
        if (m) return m[0];
    }
    return "";
}

/**
 * Raw place rows from Serper (before mapping). First matching array key wins.
 * @param {unknown} raw
 * @returns {unknown[]}
 */
function extractSerperPlaceList(raw) {
    if (!raw || typeof raw !== "object") return [];
    const o = /** @type {Record<string, unknown>} */ (raw);
    const buckets = [o.places, o.places_results, o.localResults, o.local_results];
    for (const b of buckets) {
        if (Array.isArray(b)) return b;
    }
    return [];
}

/**
 * @param {unknown[]} list
 * @returns {{ businessName: string, phone: string, email: string, address: string, website: string }[]}
 */
function normalizeSerperPlaceRows(list) {
    return list
        .map((item) => {
            const p =
                item && typeof item === "object"
                    ? /** @type {Record<string, unknown>} */ (item)
                    : {};
            return {
                businessName: String(p.title ?? p.name ?? p.placeTitle ?? "").trim(),
                phone: String(p.phoneNumber ?? p.phone ?? p.telephone ?? "").trim(),
                email: pickEmailFromPlace(p),
                address: String(p.address ?? "").trim(),
                website: String(p.website ?? p.link ?? "").trim(),
            };
        })
        .filter((row) => Boolean(row.phone) || Boolean(row.email));
}

/**
 * @param {unknown} raw
 * @returns {{ businessName: string, phone: string, email: string, address: string, website: string }[]}
 */
function normalizeSerperPlaces(raw) {
    return normalizeSerperPlaceRows(extractSerperPlaceList(raw));
}

/**
 * @param {{ businessName: string, phone: string, email: string }} row
 */
function placesLeadDedupeKey(row) {
    return [
        row.businessName.toLowerCase(),
        row.phone.toLowerCase(),
        row.email.toLowerCase(),
    ].join("\u0000");
}

const LAST_SEARCH_DIR = path.join(__dirname, "data");
const FRONTEND_BUILD_DIR = path.resolve(__dirname, "..", "frontend", "build");
const FRONTEND_INDEX_FILE = path.join(FRONTEND_BUILD_DIR, "index.html");
const LAST_SEARCH_FILE = path.join(LAST_SEARCH_DIR, "lastSearch.json");
const SEARCH_HISTORY_FILE = path.join(LAST_SEARCH_DIR, "searchHistory.json");
const SEARCH_HISTORY_MAX = 4;
const ANALYTICS_PAGE_DATA_FILE = path.join(LAST_SEARCH_DIR, "analyticsPageData.json");

const STATIC_MIME_BY_EXT = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".webp": "image/webp",
    ".map": "application/json; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
};

/**
 * @param {string} p
 */
function getStaticMimeType(p) {
    const ext = path.extname(String(p)).toLowerCase();
    return STATIC_MIME_BY_EXT[ext] || "application/octet-stream";
}

/**
 * Serve frontend build asset if it exists under frontend/build.
 * @param {string} urlPathname
 * @param {import("http").ServerResponse} res
 * @returns {boolean}
 */
function tryServeFrontendBuildAsset(urlPathname, res) {
    if (!fs.existsSync(FRONTEND_BUILD_DIR)) return false;
    const cleanPath = decodeURIComponent(String(urlPathname || "/")).replace(/^\/+/, "");
    if (!cleanPath || cleanPath.includes("..")) return false;
    const requestedPath = path.resolve(FRONTEND_BUILD_DIR, cleanPath);
    if (!requestedPath.startsWith(FRONTEND_BUILD_DIR)) return false;
    if (!fs.existsSync(requestedPath)) return false;
    const stat = fs.statSync(requestedPath);
    if (!stat.isFile()) return false;
    res.writeHead(200, { "Content-Type": getStaticMimeType(requestedPath) });
    res.end(fs.readFileSync(requestedPath));
    return true;
}

/**
 * Persists the analytics overview payload for the Analytics page (mirrors GET /analytics/overview body).
 * On disk: `{ updatedAt, ...overview }` where `overview` matches `computeAnalyticsOverview()`.
 * @param {Record<string, unknown>} overview
 */
function persistAnalyticsPageData(overview) {
    try {
        const payload = {
            updatedAt: new Date().toISOString(),
            ...overview,
        };
        fs.mkdirSync(LAST_SEARCH_DIR, { recursive: true });
        fs.writeFileSync(ANALYTICS_PAGE_DATA_FILE, JSON.stringify(payload, null, 2), "utf8");
    } catch (err) {
        console.error("[analytics-page-data] write failed", err);
    }
}

/**
 * @param {string} searchPhrase
 * @param {string} countryGl
 * @param {{ businessName: string, phone: string, email: string }[]} rows
 */
function saveLastSearchFile(searchPhrase, countryGl, rows) {
    const payload = rows.map((r) => ({
        companyName: r.businessName,
        contactNumber: r.phone,
        email: r.email,
        searchPhrase,
        country: countryGl,
    }));
    fs.mkdirSync(LAST_SEARCH_DIR, { recursive: true });
    fs.writeFileSync(LAST_SEARCH_FILE, JSON.stringify(payload, null, 2), "utf8");
}

/**
 * @returns {{ results: { businessName: string, phone: string, email: string, address: string, website: string }[], searchPhrase: string, country: string }}
 */
function readLastSearchFile() {
    /** @type {{ businessName: string, phone: string, email: string, address: string, website: string }[]} */
    const results = [];
    let searchPhrase = "";
    let country = "";
    try {
        if (!fs.existsSync(LAST_SEARCH_FILE)) {
            return { results, searchPhrase, country };
        }
        const raw = fs.readFileSync(LAST_SEARCH_FILE, "utf8").trim();
        if (!raw) return { results, searchPhrase, country };
        const data = JSON.parse(raw);
        if (!Array.isArray(data)) return { results, searchPhrase, country };

        for (const item of data) {
            if (!item || typeof item !== "object") continue;
            const o = /** @type {Record<string, unknown>} */ (item);
            if (!searchPhrase) {
                const sp = String(o.searchPhrase ?? "").trim();
                if (sp) searchPhrase = sp;
            }
            if (!country) {
                const gl = String(o.country ?? "").trim().toLowerCase();
                if (gl) country = gl;
            }
            results.push({
                businessName: String(o.companyName ?? "").trim(),
                phone: String(o.contactNumber ?? "").trim(),
                email: String(o.email ?? "").trim(),
                address: "",
                website: "",
            });
        }
        return { results, searchPhrase, country };
    } catch (err) {
        console.error("[last-search] read failed", err);
        return { results: [], searchPhrase: "", country: "" };
    }
}

/**
 * @param {string} searchPhrase
 * @param {string} countryGl
 * @param {number} resultCount
 * @param {number} pagesFetched
 */
function appendSearchHistory(searchPhrase, countryGl, resultCount, pagesFetched) {
    const entry = {
        searchPhrase: String(searchPhrase ?? "").trim(),
        country: String(countryGl ?? "").trim().toLowerCase(),
        resultCount: Number(resultCount) || 0,
        pagesFetched:
            typeof pagesFetched === "number" && Number.isFinite(pagesFetched)
                ? pagesFetched
                : null,
        searchedAt: new Date().toISOString(),
    };
    /** @type {unknown[]} */
    let prev = [];
    try {
        if (fs.existsSync(SEARCH_HISTORY_FILE)) {
            const raw = fs.readFileSync(SEARCH_HISTORY_FILE, "utf8").trim();
            if (raw) prev = JSON.parse(raw);
        }
    } catch (err) {
        console.error("[search-history] read failed", err);
        prev = [];
    }
    if (!Array.isArray(prev)) prev = [];
    const next = [entry, ...prev].slice(0, SEARCH_HISTORY_MAX);
    try {
        fs.mkdirSync(LAST_SEARCH_DIR, { recursive: true });
        fs.writeFileSync(SEARCH_HISTORY_FILE, JSON.stringify(next, null, 2), "utf8");
    } catch (err) {
        console.error("[search-history] write failed", err);
    }
}

/**
 * @returns {{ searchPhrase: string, country: string, resultCount: number, pagesFetched: number | null, searchedAt: string | null }[]}
 */
function readSearchHistoryEntries() {
    try {
        if (!fs.existsSync(SEARCH_HISTORY_FILE)) return [];
        const raw = fs.readFileSync(SEARCH_HISTORY_FILE, "utf8").trim();
        if (!raw) return [];
        const data = JSON.parse(raw);
        if (!Array.isArray(data)) return [];
        /** @type {{ searchPhrase: string, country: string, resultCount: number, pagesFetched: number | null, searchedAt: string | null }[]} */
        const out = [];
        for (const item of data) {
            if (!item || typeof item !== "object") continue;
            const o = /** @type {Record<string, unknown>} */ (item);
            const searchedAtRaw = o.searchedAt;
            const searchedAt =
                typeof searchedAtRaw === "string" && searchedAtRaw.trim()
                    ? searchedAtRaw.trim()
                    : null;
            const pf = o.pagesFetched;
            out.push({
                searchPhrase: String(o.searchPhrase ?? "").trim(),
                country: String(o.country ?? "").trim().toLowerCase(),
                resultCount: Number(o.resultCount) || 0,
                pagesFetched:
                    typeof pf === "number" && Number.isFinite(pf) ? pf : null,
                searchedAt,
            });
        }
        return out.slice(0, SEARCH_HISTORY_MAX);
    } catch (err) {
        console.error("[search-history] parse failed", err);
        return [];
    }
}

/**
 * Recent lead searches for the dashboard (newest first). Fills from `searchHistory.json`,
 * or a single row from the last search snapshot if history is empty.
 */
function getRecentSearchesForAnalytics() {
    const fromFile = readSearchHistoryEntries();
    if (fromFile.length > 0) return fromFile;
    const snap = readLastSearchFile();
    const phrase = String(snap.searchPhrase ?? "").trim();
    const n = Array.isArray(snap.results) ? snap.results.length : 0;
    if (!phrase && n === 0) return [];
    return [
        {
            searchPhrase: phrase || "(Last saved results)",
            country: String(snap.country ?? "").trim().toLowerCase() || "—",
            resultCount: n,
            pagesFetched: null,
            searchedAt: null,
        },
    ];
}

/** Spelling matches on-disk filename requested for settings categories. */
const CATEGORIES_FILE = path.join(LAST_SEARCH_DIR, "catogeries.json");

/**
 * @returns {string[]}
 */
function readCategoriesFile() {
    try {
        if (!fs.existsSync(CATEGORIES_FILE)) return [];
        const raw = fs.readFileSync(CATEGORIES_FILE, "utf8").trim();
        if (!raw) return [];
        const data = JSON.parse(raw);
        if (!Array.isArray(data)) return [];
        /** @type {string[]} */
        const out = [];
        for (const item of data) {
            const s = String(item).trim();
            if (s) out.push(s);
        }
        return out;
    } catch (err) {
        console.error("[categories] read failed", err);
        return [];
    }
}

/**
 * @param {string[]} list
 */
function writeCategoriesFile(list) {
    fs.mkdirSync(LAST_SEARCH_DIR, { recursive: true });
    fs.writeFileSync(CATEGORIES_FILE, JSON.stringify(list, null, 2), "utf8");
}

const SAVED_LEADS_FILE = path.join(LAST_SEARCH_DIR, "savedLeads.json");

/**
 * @returns {unknown[]}
 */
function readSavedLeadsFile() {
    try {
        if (!fs.existsSync(SAVED_LEADS_FILE)) return [];
        const raw = fs.readFileSync(SAVED_LEADS_FILE, "utf8").trim();
        if (!raw) return [];
        const data = JSON.parse(raw);
        return Array.isArray(data) ? data : [];
    } catch (err) {
        console.error("[saved-leads] read failed", err);
        return [];
    }
}

/**
 * @param {unknown[]} newEntries
 */
function appendSavedLeadsFile(newEntries) {
    const existing = readSavedLeadsFile();
    const merged = existing.concat(newEntries);
    fs.mkdirSync(LAST_SEARCH_DIR, { recursive: true });
    fs.writeFileSync(SAVED_LEADS_FILE, JSON.stringify(merged, null, 2), "utf8");
}

function normalizeLeadName(raw) {
    return String(raw ?? "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");
}

function normalizeLeadEmail(raw) {
    return String(raw ?? "").trim().toLowerCase();
}

function normalizeLeadPhone(raw) {
    return String(raw ?? "").replace(/\D/g, "");
}

/**
 * Excludes search rows that already exist in savedLeads.json
 * Match priority:
 * 1) phone (digits-only)
 * 2) email (lowercase)
 * 3) business name (normalized)
 * @param {{ businessName: string, phone: string, email: string, address: string, website: string }[]} rows
 */
function filterOutAlreadySavedLeads(rows) {
    const saved = readSavedLeadsFile();
    const savedPhones = new Set();
    const savedEmails = new Set();
    const savedNames = new Set();

    for (const item of saved) {
        if (!item || typeof item !== "object") continue;
        const o = /** @type {Record<string, unknown>} */ (item);
        const phone = normalizeLeadPhone(o.contactNumber ?? o.phone ?? "");
        const email = normalizeLeadEmail(o.email ?? "");
        const name = normalizeLeadName(o.companyName ?? o.businessName ?? "");
        if (phone) savedPhones.add(phone);
        if (email) savedEmails.add(email);
        if (name) savedNames.add(name);
    }

    return rows.filter((row) => {
        const phone = normalizeLeadPhone(row.phone);
        if (phone && savedPhones.has(phone)) return false;
        const email = normalizeLeadEmail(row.email);
        if (email && savedEmails.has(email)) return false;
        const name = normalizeLeadName(row.businessName);
        if (name && savedNames.has(name)) return false;
        return true;
    });
}

/**
 * @param {string} raw
 */
function hasMeaningfulContactDigits(raw) {
    const d = String(raw ?? "").replace(/\D/g, "");
    return d.length >= 6;
}

/**
 * Heuristic: Sri Lanka mobiles are typically 07 + 8 digits after the trunk 0.
 * Fixed lines use other 0XX area codes (e.g. 011, 021).
 * @param {string} raw
 */
function isLikelyLandlinePhone(raw) {
    const s = String(raw ?? "").trim();
    if (!s) return false;
    const d = s.replace(/\D/g, "");
    if (d.length < 8) return false;

    let local = d;
    if (local.startsWith("94") && local.length >= 10) {
        local = `0${local.slice(2)}`;
    }

    if (/^07\d{8}$/.test(local)) return false;

    if (local.startsWith("0") && local.length >= 9 && local.length <= 12) {
        const second = local[1];
        if (second === "7") return false;
        return true;
    }

    return false;
}

function computeLeadsDashboardStats() {
    const leads = readSavedLeadsFile();
    const categoryList = readCategoriesFile();

    let withContact = 0;
    let landlines = 0;

    for (const item of leads) {
        if (!item || typeof item !== "object") continue;
        const o = /** @type {Record<string, unknown>} */ (item);
        const phone = String(o.contactNumber ?? o.phone ?? "").trim();
        if (!phone) continue;
        if (hasMeaningfulContactDigits(phone)) {
            withContact += 1;
            if (isLikelyLandlinePhone(phone)) {
                landlines += 1;
            }
        }
    }

    return {
        allLeads: leads.length,
        categories: categoryList.length,
        withContact,
        landlines,
    };
}

const PROFILE_FILE = path.join(LAST_SEARCH_DIR, "profile.json");

const DEFAULT_PROFILE = {
    name: "Adela Pearson",
    email: "adela@example.com",
    organization: "Horizon Pro",
};

/**
 * @returns {{ name: string, email: string, organization: string }}
 */
function readProfileFile() {
    try {
        if (!fs.existsSync(PROFILE_FILE)) return { ...DEFAULT_PROFILE };
        const raw = fs.readFileSync(PROFILE_FILE, "utf8").trim();
        if (!raw) return { ...DEFAULT_PROFILE };
        const data = JSON.parse(raw);
        if (!data || typeof data !== "object") return { ...DEFAULT_PROFILE };
        const o = /** @type {Record<string, unknown>} */ (data);
        return {
            name: String(o.name ?? DEFAULT_PROFILE.name).trim() || DEFAULT_PROFILE.name,
            email: String(o.email ?? DEFAULT_PROFILE.email).trim() || DEFAULT_PROFILE.email,
            organization:
                String(o.organization ?? DEFAULT_PROFILE.organization).trim() ||
                DEFAULT_PROFILE.organization,
        };
    } catch (err) {
        console.error("[profile] read failed", err);
        return { ...DEFAULT_PROFILE };
    }
}

/**
 * @param {{ name: string, email: string, organization: string }} profile
 */
function writeProfileFile(profile) {
    fs.mkdirSync(LAST_SEARCH_DIR, { recursive: true });
    fs.writeFileSync(PROFILE_FILE, JSON.stringify(profile, null, 2), "utf8");
}

const MESSAGES_FILE = path.join(LAST_SEARCH_DIR, "messages.json");
const MESSAGES_ASSETS_DIR = path.join(LAST_SEARCH_DIR, "assets");

const MESSAGE_IMAGE_MIME_TO_EXT = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
};

const MAX_MESSAGE_IMAGE_BYTES = 6 * 1024 * 1024;

/**
 * @returns {{ id: string, text: string, imageFile: string | null, createdAt: string }[]}
 */
function readMessagesFile() {
    try {
        if (!fs.existsSync(MESSAGES_FILE)) return [];
        const raw = fs.readFileSync(MESSAGES_FILE, "utf8").trim();
        if (!raw) return [];
        const data = JSON.parse(raw);
        if (!Array.isArray(data)) return [];
        /** @type {{ id: string, text: string, imageFile: string | null, createdAt: string }[]} */
        const out = [];
        for (const item of data) {
            if (!item || typeof item !== "object") continue;
            const o = /** @type {Record<string, unknown>} */ (item);
            out.push({
                id: String(o.id ?? ""),
                text: String(o.text ?? ""),
                imageFile: o.imageFile == null ? null : String(o.imageFile),
                createdAt: String(o.createdAt ?? ""),
            });
        }
        return out.filter((m) => m.id);
    } catch (err) {
        console.error("[messages] read failed", err);
        return [];
    }
}

/**
 * @param {{ id: string, text: string, imageFile: string | null, createdAt: string }[]} list
 */
function writeMessagesFile(list) {
    fs.mkdirSync(LAST_SEARCH_DIR, { recursive: true });
    fs.writeFileSync(MESSAGES_FILE, JSON.stringify(list, null, 2), "utf8");
}

/**
 * @param {string} mime
 */
function messageImageExtForMime(mime) {
    const m = String(mime ?? "").trim().toLowerCase();
    return MESSAGE_IMAGE_MIME_TO_EXT[m] ?? null;
}

/**
 * @param {string | null | undefined} filename
 */
function safeRemoveMessageAssetFile(filename) {
    if (filename == null || filename === "") return;
    const f = String(filename);
    if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|gif|webp)$/i.test(
            f
        )
    ) {
        return;
    }
    const filePath = path.join(MESSAGES_ASSETS_DIR, f);
    const assetsRoot = path.resolve(MESSAGES_ASSETS_DIR);
    if (!filePath.startsWith(assetsRoot)) return;
    try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (err) {
        console.error("[messages] asset delete failed", err);
    }
}

const CAMPAIGNS_FILE = path.join(LAST_SEARCH_DIR, "campaigns.json");
const MESSAGE_SEND_LOG_FILE = path.join(LAST_SEARCH_DIR, "messageSendLog.json");
const MESSAGE_REPLY_LOG_FILE = path.join(LAST_SEARCH_DIR, "messageReplyLog.json");

/**
 * @returns {object[]}
 */
function seedCampaignSamples() {
    const now = Date.now();
    return [
        {
            id: "sample-spring-salons",
            name: "Spring salon outreach",
            state: "running",
            startMode: "now",
            scheduledAt: null,
            messageId: "",
            leads: [],
            createdAt: new Date(now - 86400000 * 4).toISOString(),
            updatedAt: new Date(now - 3600000).toISOString(),
            totalLeads: 48,
            completedPercent: 42,
            seenCount: 18,
            endsAt: new Date(now + 86400000 * 2 + 3600000 * 5).toISOString(),
        },
        {
            id: "sample-reengage",
            name: "Re-engage - Mahawewa leads",
            state: "scheduled",
            startMode: "scheduled",
            scheduledAt: new Date(now + 86400000 * 1).toISOString(),
            messageId: "",
            leads: [],
            createdAt: new Date(now - 86400000 * 1).toISOString(),
            updatedAt: new Date(now - 86400000 * 1).toISOString(),
            totalLeads: 120,
            completedPercent: 0,
            seenCount: 0,
            endsAt: new Date(now + 86400000 * 8).toISOString(),
        },
        {
            id: "sample-winter-followup",
            name: "Winter follow-up blast",
            state: "completed",
            startMode: "now",
            scheduledAt: null,
            messageId: "",
            leads: [],
            createdAt: new Date(now - 86400000 * 14).toISOString(),
            updatedAt: new Date(now - 86400000 * 2).toISOString(),
            totalLeads: 34,
            completedPercent: 100,
            seenCount: 29,
            endsAt: new Date(now - 86400000 * 2).toISOString(),
        },
    ];
}

/**
 * @returns {object[]}
 */
function readCampaignsFile() {
    try {
        if (!fs.existsSync(CAMPAIGNS_FILE)) {
            const seeds = seedCampaignSamples();
            fs.mkdirSync(LAST_SEARCH_DIR, { recursive: true });
            fs.writeFileSync(CAMPAIGNS_FILE, JSON.stringify(seeds, null, 2), "utf8");
            return seeds;
        }
        const raw = fs.readFileSync(CAMPAIGNS_FILE, "utf8").trim();
        if (!raw) {
            const seeds = seedCampaignSamples();
            fs.writeFileSync(CAMPAIGNS_FILE, JSON.stringify(seeds, null, 2), "utf8");
            return seeds;
        }
        const data = JSON.parse(raw);
        return Array.isArray(data) ? data : [];
    } catch (err) {
        console.error("[campaigns] read failed", err);
        return seedCampaignSamples();
    }
}

/**
 * @param {object[]} list
 */
function writeCampaignsFile(list) {
    fs.mkdirSync(LAST_SEARCH_DIR, { recursive: true });
    fs.writeFileSync(CAMPAIGNS_FILE, JSON.stringify(list, null, 2), "utf8");
}

/**
 * Mark running campaigns as completed when stored progress already reached 100%
 * (self-heal if state was never flipped after a send pass).
 * @param {object[]} list
 * @returns {object[]}
 */
function normalizeCompletedCampaignStates(list) {
    if (!Array.isArray(list)) return list;
    let changed = false;
    const next = list.map((c) => {
        const st = String(c?.state ?? "").toLowerCase();
        if (st !== "running") return c;
        const leads = Array.isArray(c.leads) ? c.leads : [];
        const tl =
            Number(c.totalLeads) > 0 && Number.isFinite(Number(c.totalLeads))
                ? Number(c.totalLeads)
                : leads.length;
        const pct = Math.min(100, Math.max(0, Number(c.completedPercent) || 0));
        const sentApprox =
            tl > 0 ? Math.min(tl, Math.round((tl * pct) / 100)) : 0;
        const complete = tl > 0 && (pct >= 100 || sentApprox >= tl);
        if (!complete) return c;
        changed = true;
        return {
            ...c,
            state: "completed",
            updatedAt: new Date().toISOString(),
        };
    });
    if (changed) writeCampaignsFile(next);
    return next;
}

/**
 * Enrich campaign rows with send-log based counts for real progress display.
 * @param {object[]} campaigns
 * @returns {object[]}
 */
function withCampaignSendStats(campaigns) {
    const list = Array.isArray(campaigns) ? campaigns : [];
    const logs = readMessageSendLog();
    /** @type {Map<string, number>} */
    const sentByCampaign = new Map();
    for (const row of logs) {
        const id = String(row?.campaignId ?? "");
        if (!id) continue;
        sentByCampaign.set(id, (sentByCampaign.get(id) || 0) + 1);
    }
    return list.map((c) => {
        const leads = Array.isArray(c?.leads) ? c.leads : [];
        const totalLeads =
            Number(c?.totalLeads) > 0 && Number.isFinite(Number(c?.totalLeads))
                ? Number(c.totalLeads)
                : leads.length;
        const sentRaw = sentByCampaign.get(String(c?.id ?? "")) || 0;
        const sentCount = Math.max(0, Math.min(totalLeads, sentRaw));
        const sendPercent =
            totalLeads > 0 ? Math.min(100, Math.round((sentCount / totalLeads) * 1000) / 10) : 0;
        return {
            ...c,
            sentCount,
            sendPercent,
        };
    });
}

const CAMPAIGN_DEFAULT_RUN_DAYS = 7;

/**
 * @param {object} campaign
 * @returns {string}
 */
function ensureCampaignEndsAtIso(campaign) {
    const nowMs = Date.now();
    const msDay = 86400000;
    const raw = campaign?.endsAt;
    const end = raw ? new Date(raw).getTime() : NaN;
    if (!Number.isFinite(end) || end <= nowMs) {
        return new Date(nowMs + CAMPAIGN_DEFAULT_RUN_DAYS * msDay).toISOString();
    }
    return String(raw);
}

/**
 * @returns {{ sentAt: string, campaignId: string, contactNumber?: string, contactName?: string, campaignName?: string }[]}
 */
function readMessageSendLog() {
    try {
        if (!fs.existsSync(MESSAGE_SEND_LOG_FILE)) return [];
        const raw = fs.readFileSync(MESSAGE_SEND_LOG_FILE, "utf8").trim();
        if (!raw) return [];
        const data = JSON.parse(raw);
        if (!Array.isArray(data)) return [];
        /** @type {{ sentAt: string, campaignId: string, contactNumber?: string, contactName?: string, campaignName?: string }[]} */
        const out = [];
        for (const row of data) {
            if (!row || typeof row !== "object") continue;
            const r = /** @type {Record<string, unknown>} */ (row);
            out.push({
                sentAt: String(r.sentAt ?? ""),
                campaignId: String(r.campaignId ?? ""),
                contactNumber: String(r.contactNumber ?? "").trim(),
                contactName: String(r.contactName ?? "").trim(),
                campaignName: String(r.campaignName ?? "").trim(),
            });
        }
        return out;
    } catch (err) {
        console.error("[message-send-log] read failed", err);
        return [];
    }
}

/**
 * @param {{ sentAt: string, campaignId: string, contactNumber?: string, contactName?: string, campaignName?: string }} entry
 */
function appendMessageSendLogEntry(entry) {
    const list = readMessageSendLog();
    list.push(entry);
    fs.mkdirSync(LAST_SEARCH_DIR, { recursive: true });
    fs.writeFileSync(MESSAGE_SEND_LOG_FILE, JSON.stringify(list, null, 2), "utf8");
}

/**
 * @returns {{ receivedAt: string, contactNumber: string, contactName?: string, chatId?: string, text?: string }[]}
 */
function readMessageReplyLog() {
    try {
        if (!fs.existsSync(MESSAGE_REPLY_LOG_FILE)) return [];
        const raw = fs.readFileSync(MESSAGE_REPLY_LOG_FILE, "utf8").trim();
        if (!raw) return [];
        const data = JSON.parse(raw);
        if (!Array.isArray(data)) return [];
        return data
            .filter((row) => row && typeof row === "object")
            .map((row) => {
                const r = /** @type {Record<string, unknown>} */ (row);
                return {
                    receivedAt: String(r.receivedAt ?? ""),
                    contactNumber: String(r.contactNumber ?? "").trim(),
                    contactName: String(r.contactName ?? "").trim(),
                    chatId: String(r.chatId ?? "").trim(),
                    text: String(r.text ?? ""),
                };
            });
    } catch (err) {
        console.error("[message-reply-log] read failed", err);
        return [];
    }
}

/**
 * @param {{ receivedAt: string, contactNumber: string, contactName?: string, chatId?: string, text?: string }} entry
 */
function appendMessageReplyLogEntry(entry) {
    const list = readMessageReplyLog();
    list.push(entry);
    fs.mkdirSync(LAST_SEARCH_DIR, { recursive: true });
    fs.writeFileSync(MESSAGE_REPLY_LOG_FILE, JSON.stringify(list, null, 2), "utf8");
}

/**
 * @param {Date} d
 */
function localDayKeyFromDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

/**
 * @param {number} dayCount
 * @returns {{ date: string, count: number }[]}
 */
function computeMessageSendsByDayLastDays(dayCount) {
    const log = readMessageSendLog();
    const now = new Date();
    /** @type {Map<string, number>} */
    const byDay = new Map();
    for (let i = dayCount - 1; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
        byDay.set(localDayKeyFromDate(d), 0);
    }
    const startOfWindow = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (dayCount - 1));
    startOfWindow.setHours(0, 0, 0, 0);
    for (const row of log) {
        const t = Date.parse(String(row.sentAt ?? ""));
        if (Number.isNaN(t)) continue;
        const dt = new Date(t);
        if (dt < startOfWindow) continue;
        const key = localDayKeyFromDate(dt);
        if (byDay.has(key)) {
            byDay.set(key, (byDay.get(key) ?? 0) + 1);
        }
    }
    return [...byDay.entries()].map(([date, count]) => ({ date, count }));
}

/**
 * Plausible bar heights for the analytics chart when there is no send log yet.
 * @returns {{ date: string, count: number }[]}
 */
function mockMessageSendsByDayLast10Days() {
    const now = new Date();
    /** @type {{ date: string, count: number }[]} */
    const out = [];
    const demoCounts = [3, 6, 4, 9, 7, 12, 10, 14, 11, 19];
    for (let i = demoCounts.length - 1; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
        out.push({ date: localDayKeyFromDate(d), count: demoCounts[demoCounts.length - 1 - i] });
    }
    return out;
}

/**
 * Campaigns where this app started outreach: not a draft and a message template is set.
 * @param {object} c
 */
function isSystemOutboundCampaign(c) {
    const st = String(c?.state ?? "").toLowerCase();
    if (st === "draft") return false;
    if (!String(c?.messageId ?? "").trim()) return false;
    return true;
}

/**
 * @param {object} c
 * @returns {number}
 */
function campaignRecencyMs(c) {
    const u = Date.parse(String(c.updatedAt ?? c.createdAt ?? ""));
    return Number.isNaN(u) ? 0 : u;
}

/**
 * Groups: live (running), upcoming (scheduled), completed, draft — in that priority for the analytics list.
 * @param {object} c
 * @returns {"live"|"upcoming"|"paused"|"completed"|"draft"}
 */
function projectStatusBucket(c) {
    const st = String(c?.state ?? "").toLowerCase();
    if (st === "running") return "live";
    if (st === "scheduled") return "upcoming";
    if (st === "paused") return "paused";
    if (st === "completed") return "completed";
    if (st === "draft") return "draft";
    return "draft";
}

/**
 * Up to `limit` campaigns: live → upcoming → paused → completed → draft (newest in each bucket).
 * @param {object[]} campaigns
 * @param {number} [limit]
 */
function buildProjectStatusCampaignsPreview(campaigns, limit = 4) {
    const list = Array.isArray(campaigns) ? campaigns : [];
    /** @type {("live"|"upcoming"|"paused"|"completed"|"draft")[]} */
    const order = ["live", "upcoming", "paused", "completed", "draft"];
    /** @type {Map<string, object[]>} */
    const byBucket = new Map();
    for (const k of order) byBucket.set(k, []);
    for (const c of list) {
        const b = projectStatusBucket(c);
        const arr = byBucket.get(b);
        if (arr) arr.push(c);
    }
    for (const k of order) {
        const arr = byBucket.get(k);
        if (arr) arr.sort((a, b) => campaignRecencyMs(b) - campaignRecencyMs(a));
    }
    /** @type {{ id: string, name: string, state: string, bucket: string, completedPercent: number }[]} */
    const out = [];
    for (const k of order) {
        const arr = byBucket.get(k) ?? [];
        for (const c of arr) {
            if (out.length >= limit) return out;
            out.push({
                id: String(c.id ?? ""),
                name: String(c.name ?? "Campaign"),
                state: String(c.state ?? ""),
                bucket: k,
                completedPercent: Math.min(100, Math.max(0, Number(c.completedPercent) || 0)),
            });
        }
    }
    return out;
}

/** When set (1/true/yes), analytics overview uses an all-mock snapshot (see analyticsPageData.json). */
function analyticsUseFullMock() {
    const v = String(process.env.ANALYTICS_USE_MOCK ?? "").toLowerCase().trim();
    return v === "1" || v === "true" || v === "yes";
}

/**
 * @returns {{ searchPhrase: string, country: string, resultCount: number, pagesFetched: number | null, searchedAt: string | null }[]}
 */
function mockAnalyticsRecentSearchesFour() {
    const now = Date.now();
    return [
        {
            searchPhrase: "salons in Chilaw",
            country: "lk",
            resultCount: 46,
            pagesFetched: 3,
            searchedAt: new Date(now - 3 * 3600000).toISOString(),
        },
        {
            searchPhrase: "cafés near Colombo Fort",
            country: "lk",
            resultCount: 31,
            pagesFetched: 2,
            searchedAt: new Date(now - 26 * 3600000).toISOString(),
        },
        {
            searchPhrase: "yoga studios Kandy",
            country: "lk",
            resultCount: 18,
            pagesFetched: 2,
            searchedAt: new Date(now - 52 * 3600000).toISOString(),
        },
        {
            searchPhrase: "auto repair Negombo",
            country: "lk",
            resultCount: 22,
            pagesFetched: 2,
            searchedAt: new Date(now - 120 * 3600000).toISOString(),
        },
    ];
}

/**
 * @returns {{ id: string, name: string, state: string, bucket: string, completedPercent: number }[]}
 */
function mockAnalyticsProjectStatusFour() {
    return [
        {
            id: "mock-analytics-live",
            name: "Spring salon outreach",
            state: "running",
            bucket: "live",
            completedPercent: 42,
        },
        {
            id: "mock-analytics-upcoming",
            name: "Holiday win-back wave",
            state: "scheduled",
            bucket: "upcoming",
            completedPercent: 0,
        },
        {
            id: "mock-analytics-completed",
            name: "January nurture sequence",
            state: "completed",
            bucket: "completed",
            completedPercent: 100,
        },
        {
            id: "mock-analytics-draft",
            name: "Q2 outbound (draft)",
            state: "draft",
            bucket: "draft",
            completedPercent: 0,
        },
    ];
}

/**
 * Full mock overview for demos (env ANALYTICS_USE_MOCK) or as a template in analyticsPageData.json.
 */
function fullMockAnalyticsOverview() {
    const messageSendsByDay = mockMessageSendsByDayLast10Days();
    const messageSendsLast10DaysTotal = messageSendsByDay.reduce((s, x) => s + x.count, 0);
    const projectStatusCampaigns = mockAnalyticsProjectStatusFour();
    const liveCampaignCount = projectStatusCampaigns.filter((x) => x.bucket === "live").length;
    return {
        ok: true,
        totalLeads: 328,
        leadsWithContact: 275,
        categoriesCount: 9,
        campaignCount: 6,
        outboundCampaignCount: 4,
        sentContacts: 856,
        repliedContacts: 201,
        replyRatePct: 23.5,
        messageSendsByDay,
        messageSendsLast10DaysTotal,
        messageSendsChartIsDemo: true,
        recentSearches: mockAnalyticsRecentSearchesFour(),
        projectStatusCampaigns,
        liveCampaignCount,
    };
}

/**
 * Fills list-shaped analytics fields when real data has no rows (Message sends chart already uses demo when empty).
 * @param {Record<string, unknown>} overview
 */
function applyAnalyticsEmptyListMocks(overview) {
    if (!Array.isArray(overview.recentSearches) || overview.recentSearches.length === 0) {
        overview.recentSearches = mockAnalyticsRecentSearchesFour();
    }
    if (!Array.isArray(overview.projectStatusCampaigns) || overview.projectStatusCampaigns.length === 0) {
        overview.projectStatusCampaigns = mockAnalyticsProjectStatusFour();
        overview.liveCampaignCount = overview.projectStatusCampaigns.filter(
            (x) => x && x.bucket === "live"
        ).length;
        overview.campaignCount = Math.max(Number(overview.campaignCount) || 0, 4);
        overview.outboundCampaignCount = Math.max(Number(overview.outboundCampaignCount) || 0, 2);
    }
}

/**
 * Dashboard analytics: saved leads, campaigns, conversion from system-outbound only.
 */
function computeAnalyticsOverview() {
    if (analyticsUseFullMock()) {
        const overview = fullMockAnalyticsOverview();
        persistAnalyticsPageData(overview);
        return overview;
    }

    const leadStats = computeLeadsDashboardStats();
    const campaigns = withCampaignSendStats(
        normalizeCompletedCampaignStates(readCampaignsFile())
    );
    const outbound = campaigns.filter(isSystemOutboundCampaign);

    const outboundIds = new Set(outbound.map((c) => String(c?.id ?? "")).filter(Boolean));
    const sentRows = readMessageSendLog().filter((r) => outboundIds.has(String(r?.campaignId ?? "")));
    const replyRows = readMessageReplyLog();
    const sentContactSet = new Set(
        sentRows
            .map((r) => normalizePhoneKey(r?.contactNumber ?? ""))
            .filter(Boolean)
    );
    const repliedContactSet = new Set(
        replyRows
            .map((r) => normalizePhoneKey(r?.contactNumber ?? ""))
            .filter((n) => Boolean(n) && sentContactSet.has(n))
    );
    let sentContacts = sentContactSet.size;
    let repliedContacts = repliedContactSet.size;

    // Fallback for older logs that may not include contact numbers yet.
    if (sentContacts === 0) {
        for (const c of outbound) {
            const nRaw = Number(c.totalLeads);
            const total =
                Number.isFinite(nRaw) && nRaw > 0
                    ? nRaw
                    : Array.isArray(c.leads)
                      ? c.leads.length
                      : 0;
            const sentRaw = Number(c.sentCount);
            const sent = Number.isFinite(sentRaw)
                ? Math.max(0, Math.min(total, sentRaw))
                : Math.min(
                      total,
                      Math.round((total * Math.min(100, Math.max(0, Number(c.completedPercent) || 0))) / 100)
                  );
            sentContacts += sent;
        }
        repliedContacts = 0;
    }
    let replyRatePct = 0;
    if (sentContacts > 0) {
        replyRatePct = Math.min(
            100,
            Math.round((repliedContacts / sentContacts) * 1000) / 10
        );
    }
    let messageSendsByDay = computeMessageSendsByDayLastDays(10);
    let messageSendsLast10DaysTotal = messageSendsByDay.reduce((s, x) => s + x.count, 0);
    let messageSendsChartIsDemo = false;
    const liveCampaignCount = campaigns.filter(
        (c) => String(c?.state ?? "").toLowerCase() === "running"
    ).length;
    const overview = {
        ok: true,
        totalLeads: leadStats.allLeads,
        leadsWithContact: leadStats.withContact,
        categoriesCount: leadStats.categories,
        campaignCount: campaigns.length,
        outboundCampaignCount: outbound.length,
        sentContacts,
        repliedContacts,
        replyRatePct,
        messageSendsByDay,
        messageSendsLast10DaysTotal,
        messageSendsChartIsDemo,
        recentSearches: getRecentSearchesForAnalytics(),
        projectStatusCampaigns: buildProjectStatusCampaignsPreview(campaigns, 4),
        liveCampaignCount,
    };
    persistAnalyticsPageData(overview);
    return overview;
}

/**
 * @param {number} ms
 */
function formatMsRemainingLong(ms) {
    if (ms == null || ms <= 0) return null;
    const d = Math.floor(ms / 86400000);
    const h = Math.floor((ms % 86400000) / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${Math.max(1, m)} min`;
}

/**
 * @param {object[]} campaigns
 */
function computeCampaignSidebarSummary(campaigns) {
    const list = Array.isArray(campaigns) ? campaigns : [];
    const nonDraft = list.filter((c) => String(c?.state ?? "").toLowerCase() !== "draft");
    let totalW = 0;
    let weighted = 0;
    for (const c of nonDraft) {
        const nRaw = Number(c.totalLeads);
        const leads =
            Number.isFinite(nRaw) && nRaw > 0
                ? nRaw
                : Array.isArray(c.leads)
                  ? c.leads.length
                  : 0;
        const sentRaw = Number(c.sentCount);
        const sentCount = Number.isFinite(sentRaw)
            ? Math.max(0, Math.min(leads, sentRaw))
            : null;
        const pctFromSent =
            sentCount != null && leads > 0
                ? Math.min(100, Math.round((sentCount / leads) * 1000) / 10)
                : null;
        const pct = Number(c.sendPercent);
        const pctFromLog = Number.isFinite(pct) ? Math.min(100, Math.max(0, pct)) : null;
        const pctFallback = Number(c.completedPercent);
        const p = pctFromSent ?? pctFromLog ?? (Number.isFinite(pctFallback) ? pctFallback : 0);
        if (leads > 0) {
            totalW += leads;
            weighted += p * leads;
        }
    }
    /**
     * Prefer running campaign; else nearest scheduled; else most recently updated non-draft.
     * @returns {object | null}
     */
    function pickFocusCampaign() {
        const running = nonDraft
            .filter((c) => String(c?.state ?? "").toLowerCase() === "running")
            .sort(
                (a, b) =>
                    new Date(String(b?.updatedAt ?? b?.createdAt ?? 0)).getTime() -
                    new Date(String(a?.updatedAt ?? a?.createdAt ?? 0)).getTime()
            );
        if (running.length > 0) return running[0];

        const nowMs = Date.now();
        const scheduled = nonDraft
            .filter((c) => String(c?.state ?? "").toLowerCase() === "scheduled")
            .map((c) => ({
                c,
                startMs: new Date(String(c?.scheduledAt ?? "")).getTime(),
            }))
            .filter((x) => Number.isFinite(x.startMs))
            .sort((a, b) => {
                const da = Math.abs(a.startMs - nowMs);
                const db = Math.abs(b.startMs - nowMs);
                return da - db;
            });
        if (scheduled.length > 0) return scheduled[0].c;

        const latest = [...nonDraft].sort(
            (a, b) =>
                new Date(String(b?.updatedAt ?? b?.createdAt ?? 0)).getTime() -
                new Date(String(a?.updatedAt ?? a?.createdAt ?? 0)).getTime()
        );
        return latest[0] ?? null;
    }

    const focusCampaign = pickFocusCampaign();

    let completionRatePct = 0;
    if (focusCampaign) {
        const leads = campaignLeadCount(focusCampaign);
        const sentRaw = Number(focusCampaign.sentCount);
        if (leads > 0 && Number.isFinite(sentRaw) && sentRaw >= 0) {
            completionRatePct = Math.min(100, Math.round((Math.min(leads, sentRaw) / leads) * 100));
        } else {
            completionRatePct = Math.min(
                100,
                Math.max(0, Math.round(Number(focusCampaign.completedPercent) || 0))
            );
        }
    } else if (totalW > 0) {
        completionRatePct = Math.round(weighted / totalW);
    } else if (nonDraft.length) {
        completionRatePct = Math.round(
            nonDraft.reduce((s, c) => s + (Number(c.completedPercent) || 0), 0) / nonDraft.length
        );
    }

    const now = Date.now();

    /**
     * @param {object} c
     */
    function campaignLeadCount(c) {
        const nRaw = Number(c.totalLeads);
        if (Number.isFinite(nRaw) && nRaw > 0) return nRaw;
        return Array.isArray(c.leads) ? c.leads.length : 0;
    }

    /**
     * @param {object} c
     */
    function campaignScheduleRemainingMs(c) {
        const leads = campaignLeadCount(c);
        if (leads <= 0) return 0;
        const sentRaw = Number(c.sentCount);
        const alreadySent =
            Number.isFinite(sentRaw) && sentRaw >= 0
                ? Math.min(leads, sentRaw)
                : Math.min(
                      leads,
                      Math.round((leads * Math.min(100, Math.max(0, Number(c.completedPercent) || 0))) / 100)
                  );
        const remaining = Math.max(0, leads - alreadySent);
        if (remaining <= 0) return 0;
        const pacingMs = whatsappThrottle.remainingThrottleDelayMs(alreadySent, remaining);
        const st = String(c?.state ?? "").toLowerCase();
        if (st === "scheduled" && c?.scheduledAt) {
            const startAt = new Date(c.scheduledAt).getTime();
            if (!Number.isNaN(startAt) && startAt > now) {
                return (startAt - now) + pacingMs;
            }
        }
        return pacingMs;
    }

    /** @type {number | null} */
    let maxRemaining = null;
    for (const c of nonDraft) {
        const st = String(c?.state ?? "").toLowerCase();
        if (st !== "running" && st !== "scheduled") continue;

        const combined = campaignScheduleRemainingMs(c);
        if (combined > 0 && (maxRemaining == null || combined > maxRemaining)) {
            maxRemaining = combined;
        }
    }

    const hasActive = nonDraft.some((c) => {
        const st = String(c?.state ?? "").toLowerCase();
        return st === "running" || st === "scheduled";
    });

    const estRaw = maxRemaining != null && maxRemaining > 0 ? formatMsRemainingLong(maxRemaining) : null;
    let estTimeToComplete = estRaw ?? "—";
    let estTimeDetail = "No active campaigns";
    if (estRaw != null) {
        estTimeDetail =
            "Latest finish based on unsent leads and WhatsApp pacing";
    } else if (hasActive) {
        estTimeToComplete = "0 min";
        estTimeDetail = "Nothing left to send, or pacing time is negligible";
    } else if (nonDraft.length > 0) {
        estTimeToComplete = "0 min";
        estTimeDetail = "All non-draft campaigns are completed";
    }

    return {
        completionRatePct,
        completionDetail: focusCampaign
            ? `${String(focusCampaign.name ?? "Campaign")} · ${String(
                  focusCampaign.state ?? ""
              ).toLowerCase() || "—"}`
            : "Weighted by lead count across non-draft campaigns",
        estTimeToComplete,
        estTimeDetail,
    };
}

/**
 * @param {object[]} campaigns
 * @param {number} limit
 * @returns {{ contactNumber: string, contactName: string, campaignName: string, sentAt: string }[]}
 */
function getRecentSentContactsFromLog(campaigns, limit = 10) {
    const list = Array.isArray(campaigns) ? campaigns : [];
    const byId = new Map(
        list.map((c) => [String(c?.id ?? ""), String(c?.name ?? "Campaign")])
    );
    const rows = readMessageSendLog()
        .filter((r) => String(r?.campaignId ?? "").trim())
        .sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime());
    return rows
        .slice(0, Math.max(1, Number(limit) || 10))
        .map((r) => {
            const phone = String(r.contactNumber ?? "").trim();
            const contactName =
                String(r.contactName ?? "").trim() || (phone ? phone : "Unknown contact");
            const campaignName =
                String(r.campaignName ?? "").trim() ||
                byId.get(String(r.campaignId ?? "")) ||
                "Campaign";
            return {
                contactNumber: phone || "—",
                contactName,
                campaignName,
                sentAt: String(r.sentAt ?? ""),
            };
        });
}

function seedRecentActivityFallback() {
    const now = Date.now();
    return [
        {
            at: new Date(now - 12 * 60000).toISOString(),
            messagePreview: "Hi! Quick follow-up on our salon promo this week.",
            contactNumber: "+94 77 012 4228",
            campaignName: "Spring salon outreach",
        },
        {
            at: new Date(now - 38 * 60000).toISOString(),
            messagePreview: "Thanks for your interest — here are our services and hours.",
            contactNumber: "+94 77 471 1651",
            campaignName: "Re-engage - Mahawewa leads",
        },
        {
            at: new Date(now - 3 * 3600000).toISOString(),
            messagePreview: "Winter special: book before Friday for 15% off.",
            contactNumber: "+94 77 540 4040",
            campaignName: "Winter follow-up blast",
        },
        {
            at: new Date(now - 26 * 3600000).toISOString(),
            messagePreview: "Hello! We wanted to reach out about your last visit.",
            contactNumber: "+94 71 555 0198",
            campaignName: "Spring salon outreach",
        },
        {
            at: new Date(now - 52 * 3600000).toISOString(),
            messagePreview: "Reminder: your appointment window is open — reply YES to confirm.",
            contactNumber: "+94 76 222 4411",
            campaignName: "Re-engage - Mahawewa leads",
        },
    ];
}

function buildRecentActivityItems() {
    const campaigns = readCampaignsFile().sort((a, b) =>
        String(b.updatedAt ?? b.createdAt ?? "").localeCompare(
            String(a.updatedAt ?? a.createdAt ?? "")
        )
    );
    const messages = readMessagesFile();
    const msgById = new Map(messages.map((m) => [m.id, m]));
    /** @type {object[]} */
    const items = [];
    let stagger = 0;
    for (const camp of campaigns) {
        const msg =
            camp.messageId && msgById.has(camp.messageId) ? msgById.get(camp.messageId) : null;
        let preview = "";
        if (msg?.text && String(msg.text).trim()) {
            preview = String(msg.text).trim().slice(0, 120);
        } else if (msg?.imageFile) {
            preview = "(Image message)";
        } else {
            preview = "—";
        }
        const leads = Array.isArray(camp.leads) ? camp.leads : [];
        const base = Date.parse(String(camp.updatedAt || camp.createdAt)) || Date.now();
        for (const lead of leads) {
            if (items.length >= 10) break;
            const phone = String(lead.contactNumber ?? "").trim();
            if (!phone) continue;
            items.push({
                at: new Date(base - stagger * 120000).toISOString(),
                messagePreview: preview,
                contactNumber: phone,
                campaignName: String(camp.name ?? "Campaign"),
            });
            stagger += 1;
        }
        if (items.length >= 10) break;
    }
    const seeds = seedRecentActivityFallback();
    for (const s of seeds) {
        if (items.length >= 10) break;
        items.push(s);
    }
    return items.slice(0, 10);
}

const qrcode = require("qrcode-terminal");
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");

// "1369" => 1369. Allow overriding via PORT env var.
const PORT = Number(process.env.PORT ?? 1369);
const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "admin";

/** @type {{ state: string, qr?: string, message?: string, reason?: string, info?: { wid?: string, pushname?: string, platform?: string } }} */
let whatsappState = { state: "initializing" };
let whatsappInitializing = false;
let whatsappReconnectAttempts = 0;
let whatsappReconnectTimer = null;

function emptyEmailIntegration() {
    return {
        connected: false,
        email: "",
        smtpHost: "",
        smtpPort: 587,
        smtpUser: "",
        smtpPassword: "",
        smtpSecure: true,
    };
}

/** @type {ReturnType<typeof emptyEmailIntegration>} */
let emailIntegration = emptyEmailIntegration();

function resolveChromeExecutable() {
    // Allow explicit override.
    if (process.env.PUPPETEER_EXECUTABLE_PATH && fs.existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) {
        return process.env.PUPPETEER_EXECUTABLE_PATH;
    }

    const candidates = [
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    ];

    for (const p of candidates) {
        if (fs.existsSync(p)) return p;
    }
    return null;
}

const isLinux = process.platform === "linux";
const puppeteerOptions = { headless: true };
const chromeExecutablePath = resolveChromeExecutable();
if (chromeExecutablePath) puppeteerOptions.executablePath = chromeExecutablePath;
if (isLinux) {
    // Ubuntu/AppArmor environments often block Chromium sandbox in server contexts.
    puppeteerOptions.args = [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
    ];
}

const whatsappClient = new Client({
    authStrategy: new LocalAuth({
        // Keep WhatsApp session data inside backend/.
        dataPath: path.join(__dirname, ".wwebjs_auth"),
    }),
    puppeteer: puppeteerOptions,
});

function clearWhatsAppReconnectTimer() {
    if (whatsappReconnectTimer) {
        clearTimeout(whatsappReconnectTimer);
        whatsappReconnectTimer = null;
    }
}

function scheduleWhatsAppReconnect(reasonText) {
    clearWhatsAppReconnectTimer();
    const attempt = Math.min(whatsappReconnectAttempts + 1, 8);
    whatsappReconnectAttempts = attempt;
    const delayMs = Math.min(60000, 1500 * Math.pow(2, attempt - 1));
    console.log(
        `[whatsapp] scheduling reconnect in ${Math.round(delayMs / 1000)}s (attempt ${attempt}) reason=${String(
            reasonText || "unknown"
        )}`
    );
    whatsappReconnectTimer = setTimeout(() => {
        whatsappReconnectTimer = null;
        initializeWhatsAppClient("scheduled_reconnect");
    }, delayMs);
}

function isTransientWhatsAppInitError(err) {
    const msg = String(err?.message ?? err ?? "").toLowerCase();
    return (
        msg.includes("execution context was destroyed") ||
        msg.includes("target closed") ||
        msg.includes("session closed") ||
        msg.includes("navigation")
    );
}

function initializeWhatsAppClient(source = "startup") {
    if (whatsappInitializing) {
        console.log(`[whatsapp] initialize skipped; already in progress (source=${source})`);
        return;
    }
    whatsappInitializing = true;
    console.log(`[whatsapp] initialize start (source=${source})`);
    whatsappClient
        .initialize()
        .catch((err) => {
            const message = err?.message ? String(err.message) : String(err);
            whatsappState = { state: "init_error", message };
            console.error("Failed to initialize WhatsApp client:", err);
            if (isTransientWhatsAppInitError(err)) {
                scheduleWhatsAppReconnect(message);
            }
        })
        .finally(() => {
            whatsappInitializing = false;
        });
}

whatsappClient.on("qr", (qr) => {
    whatsappState = { state: "qr", qr };
    console.log("Scan the WhatsApp QR (terminal):");
    qrcode.generate(qr, { small: true });
});

whatsappClient.on("ready", () => {
    /** @type {{ wid?: string, pushname?: string, platform?: string } | undefined} */
    let infoPayload;
    try {
        const info = whatsappClient.info;
        if (info && info.wid) {
            const widUser =
                typeof info.wid === "object" && info.wid !== null && "user" in info.wid
                    ? String(info.wid.user)
                    : String(info.wid);
            infoPayload = {
                wid: widUser,
                pushname: info.pushname ? String(info.pushname) : "",
                platform: info.platform ? String(info.platform) : "",
            };
        }
    } catch {
        // ignore
    }
    whatsappState = { state: "ready", info: infoPayload };
    whatsappReconnectAttempts = 0;
    clearWhatsAppReconnectTimer();
    console.log("WhatsApp client is ready");
});

whatsappClient.on("authenticated", () => {
    whatsappState = { state: "authenticated" };
    whatsappReconnectAttempts = 0;
    clearWhatsAppReconnectTimer();
    console.log("WhatsApp authenticated");
});

whatsappClient.on("auth_failure", (msg) => {
    whatsappState = { state: "auth_failure", message: String(msg) };
    console.error("WhatsApp auth failure:", msg);
});

whatsappClient.on("disconnected", (reason) => {
    const reasonText = String(reason);
    whatsappState = { state: "disconnected", reason: reasonText };
    console.log("WhatsApp disconnected:", reasonText);
    if (reasonText.toUpperCase() === "LOGOUT") {
        clearWhatsAppReconnectTimer();
        whatsappReconnectAttempts = 0;
        return;
    }
    scheduleWhatsAppReconnect(reasonText);
});

whatsappClient.on("message", (msg) => {
    try {
        // Print any inbound message to terminal (number + text).
        if (msg?.fromMe) return;
        const chatId = String(msg?.from ?? "");
        if (!chatId) return;
        const contactNumber = chatId.endsWith("@c.us")
            ? phoneFromWhatsAppChatId(chatId)
            : normalizePhoneKey(chatId);
        const numberForPrint = contactNumber || chatId;
        const textPreview = String(msg?.body ?? "").slice(0, 240);
        console.log(
            `[whatsapp-inbox] from=${numberForPrint} text=${JSON.stringify(textPreview)}`
        );

        // Only 1:1 contacts are used for conversion tracking.
        if (!chatId.endsWith("@c.us") || !contactNumber) return;
        const contactName = String(
            msg?._data?.notifyName ?? msg?._data?.from ?? contactNumber
        ).trim();
        appendMessageReplyLogEntry({
            receivedAt: new Date().toISOString(),
            contactNumber,
            contactName,
            chatId,
            text: textPreview,
        });
        console.log(
            `[whatsapp-inbound] from=${contactNumber} name=${JSON.stringify(contactName)}`
        );
    } catch (err) {
        console.error("[whatsapp-reply-log] append failed", err);
    }
});

initializeWhatsAppClient("startup");

const campaignWhatsAppSendLocks = new Set();

/**
 * @param {string} raw
 */
function toWhatsAppChatId(raw) {
    let d = String(raw ?? "").replace(/\D/g, "");
    if (!d) return null;
    if (d.startsWith("0") && d.length === 10) d = `94${d.slice(1)}`;
    return `${d}@c.us`;
}

/**
 * Normalize a phone/chat identifier to a comparable local-ish key.
 * Examples: "077 123 4567" -> "0771234567", "94771234567@c.us" -> "0771234567"
 * @param {string} raw
 */
function normalizePhoneKey(raw) {
    let d = String(raw ?? "").replace(/\D/g, "");
    if (!d) return "";
    if (d.startsWith("94") && d.length >= 11) {
        d = `0${d.slice(2)}`;
    }
    return d;
}

/**
 * @param {string} chatId
 */
function phoneFromWhatsAppChatId(chatId) {
    const base = String(chatId ?? "").split("@")[0];
    return normalizePhoneKey(base);
}

/**
 * @param {unknown} err
 */
function isRetriableWhatsAppSendError(err) {
    const msg = String(err?.message ?? err ?? "").toLowerCase();
    return (
        msg.includes("getchat") ||
        msg.includes("no lid for user") ||
        msg.includes("wid error") ||
        msg.includes("evaluation failed") ||
        msg.includes("execution context")
    );
}

/**
 * Errors that indicate WA web context/session is not usable right now.
 * @param {unknown} err
 */
function isWhatsAppSessionContextError(err) {
    const msg = String(err?.message ?? err ?? "").toLowerCase();
    return (
        msg.includes("widfactory") ||
        msg.includes("getchat") ||
        msg.includes("execution context was destroyed") ||
        msg.includes("cannot find context with specified id")
    );
}

/**
 * Fire-and-forget WhatsApp send for a campaign (same as POST …/send-whatsapp).
 * @param {string} campaignId
 */
function scheduleCampaignWhatsAppSend(campaignId) {
    setImmediate(() => {
        runCampaignWhatsAppSendBackground(campaignId).catch((e) =>
            console.error("[whatsapp-send] background", e)
        );
    });
}

/**
 * Sends campaign template to each lead with a phone number, using WhatsApp send pacing rules.
 * @param {string} campaignId
 */
async function runCampaignWhatsAppSendBackground(campaignId) {
    if (campaignWhatsAppSendLocks.has(campaignId)) {
        console.log(`[whatsapp-send] already running for ${campaignId}`);
        return;
    }
    campaignWhatsAppSendLocks.add(campaignId);
    try {
        if (whatsappState.state !== "ready") {
            console.error("[whatsapp-send] WhatsApp client not ready");
            return;
        }
        const list = readCampaignsFile();
        const camp = list.find((c) => c.id === campaignId);
        if (!camp) {
            console.error("[whatsapp-send] campaign not found", campaignId);
            return;
        }
        const messages = readMessagesFile();
        const msg = messages.find((m) => m.id === camp.messageId);
        if (!msg) {
            console.error("[whatsapp-send] message template not found", camp.messageId);
            return;
        }
        const leads = Array.isArray(camp.leads) ? camp.leads : [];
        const withPhone = leads.filter((l) => String(l.contactNumber ?? "").trim());
        if (withPhone.length === 0) {
            console.error("[whatsapp-send] no leads with contact numbers");
            return;
        }
        const totalLeads =
            Number(camp.totalLeads) > 0 && Number.isFinite(Number(camp.totalLeads))
                ? Number(camp.totalLeads)
                : leads.length;
        const pct = Math.min(100, Math.max(0, Number(camp.completedPercent) || 0));
        /** Successful sends already counted in completedPercent before this run */
        let cumulativeSent = Math.min(
            totalLeads,
            Math.round((totalLeads * pct) / 100)
        );
        let successInLoop = 0;

        let abortLoop = false;
        for (let i = 0; i < withPhone.length; i++) {
            if (abortLoop) break;
            if (whatsappState.state !== "ready") {
                console.error(
                    `[whatsapp-send] stopping campaign=${campaignId}; WhatsApp state=${whatsappState.state}`
                );
                break;
            }
            const lead = withPhone[i];
            const chatId = toWhatsAppChatId(lead.contactNumber);
            if (!chatId) continue;
            /** @type {boolean} */
            let delivered = false;
            let sendError = null;
            try {
                let isRegistered = true;
                try {
                    if (typeof whatsappClient.isRegisteredUser === "function") {
                        isRegistered = Boolean(await whatsappClient.isRegisteredUser(chatId));
                    }
                } catch (e) {
                    if (isWhatsAppSessionContextError(e)) {
                        console.error(
                            `[whatsapp-send] WA context unavailable during registration check; aborting pass campaign=${campaignId}`
                        );
                        abortLoop = true;
                        break;
                    }
                    // If lookup fails, continue and let send attempt decide.
                    console.warn(
                        `[whatsapp-send] registration check failed ${chatId}: ${String(e?.message ?? e)}`
                    );
                }
                if (!isRegistered) {
                    console.warn(`[whatsapp-send] skip unregistered number ${chatId}`);
                    continue;
                }

                const trySend = async () => {
                    if (msg.imageFile) {
                        const assetPath = path.join(MESSAGES_ASSETS_DIR, msg.imageFile);
                        if (fs.existsSync(assetPath)) {
                            const media = MessageMedia.fromFilePath(assetPath);
                            await whatsappClient.sendMessage(chatId, media, {
                                caption: String(msg.text ?? "").trim() || undefined,
                            });
                            return true;
                        }
                        if (String(msg.text ?? "").trim()) {
                            await whatsappClient.sendMessage(chatId, String(msg.text).trim());
                            return true;
                        }
                        return false;
                    }
                    if (String(msg.text ?? "").trim()) {
                        await whatsappClient.sendMessage(chatId, String(msg.text).trim());
                        return true;
                    }
                    return false;
                };

                try {
                    delivered = await trySend();
                } catch (firstErr) {
                    sendError = firstErr;
                    if (isRetriableWhatsAppSendError(firstErr)) {
                        await whatsappThrottle.sleep(1500);
                        delivered = await trySend();
                        sendError = null;
                    } else {
                        throw firstErr;
                    }
                }
            } catch (e) {
                sendError = e;
            }
            if (sendError) {
                console.error(
                    `[whatsapp-send] ${chatId}`,
                    sendError?.message ? String(sendError.message) : sendError
                );
                if (isWhatsAppSessionContextError(sendError)) {
                    console.error(
                        `[whatsapp-send] WA context unavailable during send; aborting remaining contacts campaign=${campaignId}`
                    );
                    abortLoop = true;
                }
            }
            if (delivered) {
                appendMessageSendLogEntry({
                    sentAt: new Date().toISOString(),
                    campaignId: String(campaignId),
                    contactNumber: String(lead?.contactNumber ?? "").trim(),
                    contactName:
                        String(lead?.companyName ?? "").trim() ||
                        String(lead?.email ?? "").trim() ||
                        String(lead?.contactNumber ?? "").trim(),
                    campaignName: String(camp?.name ?? "").trim(),
                });
                console.log(
                    `[whatsapp-outbound] campaign=${String(camp?.name ?? campaignId)} to=${String(
                        lead?.contactNumber ?? ""
                    ).trim()} name=${JSON.stringify(
                        String(lead?.companyName ?? "").trim() || String(lead?.email ?? "").trim()
                    )}`
                );
                successInLoop += 1;
                cumulativeSent = Math.min(totalLeads, cumulativeSent + 1);
            }

            if (i < withPhone.length - 1) {
                const waitMs = delivered
                    ? whatsappThrottle.delayMsAfterCompletedSend(cumulativeSent)
                    : whatsappThrottle.MINUTE_MS;
                console.log(
                    `[whatsapp-send] wait ${Math.round(waitMs / 1000)}s (cumulative sent ≈ ${cumulativeSent}, pacing)`
                );
                await whatsappThrottle.sleep(waitMs);
            }
        }

        try {
            const fresh = readCampaignsFile();
            const idx = fresh.findIndex((c) => String(c.id) === campaignId);
            if (idx !== -1) {
                const c = fresh[idx];
                const tl =
                    Number(c.totalLeads) > 0 && Number.isFinite(Number(c.totalLeads))
                        ? Number(c.totalLeads)
                        : Array.isArray(c.leads)
                          ? c.leads.length
                          : totalLeads;
                const prevPct = Math.min(100, Math.max(0, Number(c.completedPercent) || 0));
                const prevSent = Math.min(tl, Math.round((tl * prevPct) / 100));
                const newSent = Math.min(tl, prevSent + successInLoop);
                const newPct = tl > 0 ? Math.min(100, Math.round((newSent / tl) * 1000) / 10) : 0;
                const sendPassComplete =
                    tl > 0 && (newSent >= tl || newPct >= 100);
                fresh[idx] = {
                    ...c,
                    completedPercent: newPct,
                    updatedAt: new Date().toISOString(),
                    ...(sendPassComplete ? { state: "completed" } : {}),
                };
                writeCampaignsFile(fresh);
                console.log(
                    `[whatsapp-send] saved progress campaign=${campaignId} ${newPct}% (${newSent}/${tl})${
                        sendPassComplete ? " → completed" : ""
                    }`
                );
            }
        } catch (e) {
            console.error("[whatsapp-send] could not save campaign progress", e);
        }

        console.log(`[whatsapp-send] done campaign=${campaignId}`);
    } finally {
        campaignWhatsAppSendLocks.delete(campaignId);
    }
}

function getCorsHeaders(req) {
    const origin = req.headers.origin;
    return {
        "Access-Control-Allow-Origin": origin || "*",
        "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
    };
}

function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        let data = "";
        req.on("data", (chunk) => {
            data += String(chunk);
        });
        req.on("end", () => {
            if (!data.trim()) return resolve({});
            try {
                resolve(JSON.parse(data));
            } catch (err) {
                reject(err);
            }
        });
        req.on("error", reject);
    });
}

const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    const httpStarted = Date.now();
    res.on("finish", () => {
        const mode = httpLogMode();
        if (mode === "off") return;
        if (
            mode === "default" &&
            req.method === "GET" &&
            HTTP_LOG_QUIET_PATHS.has(url.pathname)
        ) {
            return;
        }
        const ms = Date.now() - httpStarted;
        console.log(`[HTTP] ${req.method} ${url.pathname} → ${res.statusCode} (${ms}ms)`);
    });

    // CORS for frontend -> backend calls
    const corsHeaders = getCorsHeaders(req);
    for (const [k, v] of Object.entries(corsHeaders)) res.setHeader(k, v);

    if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
    }

    if (req.method === "GET" && url.pathname === "/") {
        if (fs.existsSync(FRONTEND_INDEX_FILE)) {
            res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
            res.end(fs.readFileSync(FRONTEND_INDEX_FILE, "utf8"));
            return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, message: "Backend server is running", port: PORT }));
        return;
    }

    if (req.method === "GET" && url.pathname === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
    }

    if (req.method === "GET" && url.pathname === "/profile") {
        const profile = readProfileFile();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, profile }));
        return;
    }

    if (req.method === "POST" && url.pathname === "/profile") {
        readJsonBody(req)
            .then((body) => {
                const name = String(body?.name ?? "").trim();
                const email = String(body?.email ?? "").trim();
                const organization = String(body?.organization ?? "").trim();

                if (!name || !email) {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(
                        JSON.stringify({
                            ok: false,
                            error: "Name and email are required",
                        })
                    );
                    return;
                }

                const profile = { name, email, organization };
                writeProfileFile(profile);
                console.log(
                    `[profile] saved → ${path.relative(__dirname, PROFILE_FILE)}`
                );

                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: true, profile }));
            })
            .catch(() => {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "Invalid JSON body" }));
            });
        return;
    }

    if (req.method === "GET" && url.pathname === "/messages/asset") {
        const f = url.searchParams.get("f");
        const safe =
            typeof f === "string" &&
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|gif|webp)$/i.test(
                f
            );
        if (!safe) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: "Invalid file name" }));
            return;
        }
        const filePath = path.join(MESSAGES_ASSETS_DIR, f);
        const assetsRoot = path.resolve(MESSAGES_ASSETS_DIR);
        if (!filePath.startsWith(assetsRoot)) {
            res.writeHead(400);
            res.end();
            return;
        }
        if (!fs.existsSync(filePath)) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: "Not found" }));
            return;
        }
        const ext = path.extname(f).toLowerCase();
        const contentType =
            ext === ".png"
                ? "image/png"
                : ext === ".jpg" || ext === ".jpeg"
                  ? "image/jpeg"
                  : ext === ".gif"
                    ? "image/gif"
                    : ext === ".webp"
                      ? "image/webp"
                      : "application/octet-stream";
        res.writeHead(200, {
            "Content-Type": contentType,
            "Cache-Control": "public, max-age=86400",
        });
        res.end(fs.readFileSync(filePath));
        return;
    }

    if (req.method === "GET" && url.pathname === "/messages") {
        const messages = readMessagesFile().sort((a, b) =>
            String(b.createdAt).localeCompare(String(a.createdAt))
        );
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, messages }));
        return;
    }

    if (req.method === "POST" && url.pathname === "/messages") {
        readJsonBody(req)
            .then((body) => {
                const text = String(body?.text ?? "").trim();
                const imageBase64 = body?.imageBase64;
                const imageMime = String(body?.imageMime ?? "").trim().toLowerCase();

                const hasImage =
                    imageBase64 != null &&
                    String(imageBase64).replace(/\s/g, "").length > 0;

                if (!text && !hasImage) {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(
                        JSON.stringify({
                            ok: false,
                            error: "Add message text and/or an image",
                        })
                    );
                    return;
                }

                let imageFile = null;
                if (hasImage) {
                    const ext = messageImageExtForMime(imageMime);
                    if (!ext) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(
                            JSON.stringify({
                                ok: false,
                                error: "Image must be JPEG, PNG, GIF, or WebP",
                            })
                        );
                        return;
                    }
                    let buf;
                    try {
                        buf = Buffer.from(
                            String(imageBase64).replace(/\s/g, ""),
                            "base64"
                        );
                    } catch {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "Invalid image data" }));
                        return;
                    }
                    if (!buf.length || buf.length > MAX_MESSAGE_IMAGE_BYTES) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(
                            JSON.stringify({
                                ok: false,
                                error: "Image too large (max 6MB)",
                            })
                        );
                        return;
                    }
                    const name = `${crypto.randomUUID()}${ext}`;
                    fs.mkdirSync(MESSAGES_ASSETS_DIR, { recursive: true });
                    fs.writeFileSync(path.join(MESSAGES_ASSETS_DIR, name), buf);
                    imageFile = name;
                }

                const id = crypto.randomUUID();
                const createdAt = new Date().toISOString();
                const entry = { id, text, imageFile, createdAt };
                const list = readMessagesFile();
                list.push(entry);
                writeMessagesFile(list);
                console.log(
                    `[messages] saved id=${id} hasImage=${Boolean(imageFile)} → ${path.relative(__dirname, MESSAGES_FILE)}`
                );

                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: true, message: entry }));
            })
            .catch(() => {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "Invalid JSON body" }));
            });
        return;
    }

    if (req.method === "PUT" && url.pathname === "/messages") {
        readJsonBody(req)
            .then((body) => {
                const id = String(body?.id ?? "").trim();
                const text = String(body?.text ?? "").trim();
                const removeImage = Boolean(body?.removeImage);
                const imageBase64 = body?.imageBase64;
                const imageMime = String(body?.imageMime ?? "").trim().toLowerCase();

                if (!id) {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "Missing message id" }));
                    return;
                }

                const list = readMessagesFile();
                const idx = list.findIndex((m) => m.id === id);
                if (idx === -1) {
                    res.writeHead(404, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "Message not found" }));
                    return;
                }

                const prev = list[idx];
                const hasNewImage =
                    imageBase64 != null &&
                    String(imageBase64).replace(/\s/g, "").length > 0;

                /** @type {string | null} */
                let imageFile = prev.imageFile;

                if (hasNewImage) {
                    const ext = messageImageExtForMime(imageMime);
                    if (!ext) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(
                            JSON.stringify({
                                ok: false,
                                error: "Image must be JPEG, PNG, GIF, or WebP",
                            })
                        );
                        return;
                    }
                    let buf;
                    try {
                        buf = Buffer.from(
                            String(imageBase64).replace(/\s/g, ""),
                            "base64"
                        );
                    } catch {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "Invalid image data" }));
                        return;
                    }
                    if (!buf.length || buf.length > MAX_MESSAGE_IMAGE_BYTES) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(
                            JSON.stringify({
                                ok: false,
                                error: "Image too large (max 6MB)",
                            })
                        );
                        return;
                    }
                    safeRemoveMessageAssetFile(prev.imageFile);
                    const name = `${crypto.randomUUID()}${ext}`;
                    fs.mkdirSync(MESSAGES_ASSETS_DIR, { recursive: true });
                    fs.writeFileSync(path.join(MESSAGES_ASSETS_DIR, name), buf);
                    imageFile = name;
                } else if (removeImage) {
                    safeRemoveMessageAssetFile(prev.imageFile);
                    imageFile = null;
                }

                if (!text && !imageFile) {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(
                        JSON.stringify({
                            ok: false,
                            error: "Add message text and/or an image",
                        })
                    );
                    return;
                }

                const entry = {
                    id: prev.id,
                    text,
                    imageFile,
                    createdAt: prev.createdAt,
                };
                list[idx] = entry;
                writeMessagesFile(list);
                console.log(
                    `[messages] updated id=${id} hasImage=${Boolean(imageFile)} → ${path.relative(__dirname, MESSAGES_FILE)}`
                );

                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: true, message: entry }));
            })
            .catch(() => {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "Invalid JSON body" }));
            });
        return;
    }

    if (req.method === "DELETE" && url.pathname === "/messages") {
        const id = String(url.searchParams.get("id") ?? "").trim();
        if (!id) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: "Missing message id" }));
            return;
        }

        const list = readMessagesFile();
        const idx = list.findIndex((m) => m.id === id);
        if (idx === -1) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: "Message not found" }));
            return;
        }

        const [removed] = list.splice(idx, 1);
        safeRemoveMessageAssetFile(removed.imageFile);
        writeMessagesFile(list);
        console.log(`[messages] deleted id=${id} → ${path.relative(__dirname, MESSAGES_FILE)}`);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
    }

    if (req.method === "GET" && url.pathname === "/categories") {
        const categories = readCategoriesFile();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, categories }));
        return;
    }

    if (req.method === "POST" && url.pathname === "/categories") {
        readJsonBody(req)
            .then((body) => {
                const name = String(body?.name ?? "").trim();
                if (!name) {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "Missing category name" }));
                    return;
                }

                const list = readCategoriesFile();
                const lower = name.toLowerCase();
                if (list.some((c) => c.toLowerCase() === lower)) {
                    res.writeHead(409, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "Category already exists" }));
                    return;
                }

                list.push(name);
                writeCategoriesFile(list);
                console.log(`[categories] added ${JSON.stringify(name)} → ${path.relative(__dirname, CATEGORIES_FILE)}`);

                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: true, categories: list }));
            })
            .catch(() => {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "Invalid JSON body" }));
            });
        return;
    }

    if (req.method === "POST") {
        const sendMatch = url.pathname.match(/^\/campaigns\/([^/]+)\/send-whatsapp$/);
        if (sendMatch) {
            const campaignId = decodeURIComponent(sendMatch[1]);
            scheduleCampaignWhatsAppSend(campaignId);
            res.writeHead(202, { "Content-Type": "application/json" });
            res.end(
                JSON.stringify({
                    ok: true,
                    queued: true,
                    campaignId,
                    pacing:
                        "1 min between contacts; +10 min after each 10; +40 min after each 100",
                })
            );
            return;
        }
    }

    if (req.method === "GET" && url.pathname === "/campaigns") {
        const campaigns = withCampaignSendStats(
            normalizeCompletedCampaignStates(readCampaignsFile())
        );
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, campaigns }));
        return;
    }

    if (req.method === "POST" && url.pathname === "/campaigns") {
        readJsonBody(req)
            .then((body) => {
                const name = String(body?.name ?? "").trim();
                const startMode = String(body?.startMode ?? "").trim().toLowerCase();
                const scheduledAtRaw = body?.scheduledAt;
                const messageId = String(body?.messageId ?? "").trim();
                const rawLeads = body?.leads;

                if (!name) {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "Campaign name is required" }));
                    return;
                }

                if (!["draft", "now", "scheduled"].includes(startMode)) {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(
                        JSON.stringify({
                            ok: false,
                            error: "startMode must be draft, now, or scheduled",
                        })
                    );
                    return;
                }

                /** @type {string | null} */
                let scheduledAt = null;
                if (startMode === "scheduled") {
                    const s = scheduledAtRaw != null ? String(scheduledAtRaw).trim() : "";
                    if (!s) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(
                            JSON.stringify({
                                ok: false,
                                error: "Pick a start date and time for a scheduled campaign",
                            })
                        );
                        return;
                    }
                    const d = new Date(s);
                    if (Number.isNaN(d.getTime())) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "Invalid scheduledAt date" }));
                        return;
                    }
                    scheduledAt = d.toISOString();
                }

                const messages = readMessagesFile();
                if (!messages.some((m) => m.id === messageId)) {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "Unknown message — pick a saved message" }));
                    return;
                }

                if (!Array.isArray(rawLeads) || rawLeads.length === 0) {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "Select at least one lead" }));
                    return;
                }

                /** @type {object[]} */
                const leads = [];
                for (const item of rawLeads) {
                    const row = item && typeof item === "object" ? item : {};
                    const r = /** @type {Record<string, unknown>} */ (row);
                    const companyName = String(r.companyName ?? "").trim();
                    const contactNumber = String(r.contactNumber ?? "").trim();
                    const email = String(r.email ?? "").trim();
                    const searchPhrase = String(r.searchPhrase ?? "").trim();
                    const category = String(r.category ?? "").trim();
                    const country = String(r.country ?? "").trim();
                    if (!companyName && !contactNumber && !email) continue;
                    leads.push({
                        companyName,
                        contactNumber,
                        email,
                        searchPhrase,
                        category,
                        country,
                    });
                }

                if (leads.length === 0) {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(
                        JSON.stringify({
                            ok: false,
                            error: "No valid leads in selection (need company, phone, or email)",
                        })
                    );
                    return;
                }

                const nowMs = Date.now();
                const id = crypto.randomUUID();
                const createdAt = new Date().toISOString();
                const campaignDays = 7;
                const msDay = 86400000;

                /** @type {string} */
                let state;
                /** @type {string | null} */
                let endsAt = null;

                if (startMode === "draft") {
                    state = "draft";
                } else if (startMode === "now") {
                    state = "running";
                    endsAt = new Date(nowMs + campaignDays * msDay).toISOString();
                } else {
                    state = "scheduled";
                    const startMs = new Date(/** @type {string} */ (scheduledAt)).getTime();
                    endsAt = new Date(startMs + campaignDays * msDay).toISOString();
                }

                const entry = {
                    id,
                    name,
                    state,
                    startMode,
                    scheduledAt: startMode === "scheduled" ? scheduledAt : null,
                    messageId,
                    leads,
                    createdAt,
                    updatedAt: createdAt,
                    totalLeads: leads.length,
                    completedPercent: 0,
                    seenCount: 0,
                    endsAt,
                };

                const list = readCampaignsFile();
                list.push(entry);
                writeCampaignsFile(list);
                console.log(
                    `[campaigns] created id=${id} name=${JSON.stringify(name)} leads=${leads.length} → ${path.relative(__dirname, CAMPAIGNS_FILE)}`
                );

                if (entry.state === "running") {
                    scheduleCampaignWhatsAppSend(id);
                    console.log(`[campaigns] queued WhatsApp send for ${id} (start now)`);
                }

                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: true, campaign: entry }));
            })
            .catch(() => {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "Invalid JSON body" }));
            });
        return;
    }

    const campaignByIdPath = url.pathname.match(/^\/campaigns\/([^/]+)$/);
    if (campaignByIdPath && req.method === "PATCH") {
        const campaignId = decodeURIComponent(campaignByIdPath[1]);
        readJsonBody(req)
            .then((body) => {
                const action = String(body?.action ?? "").trim().toLowerCase();
                if (action !== "pause" && action !== "start") {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(
                        JSON.stringify({
                            ok: false,
                            error: 'action must be "pause" or "start"',
                        })
                    );
                    return;
                }
                const list = readCampaignsFile();
                const idx = list.findIndex((c) => String(c?.id) === campaignId);
                if (idx === -1) {
                    res.writeHead(404, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "Campaign not found" }));
                    return;
                }
                const camp = list[idx];
                const st = String(camp.state ?? "").toLowerCase();
                const nowIso = new Date().toISOString();
                if (action === "pause") {
                    if (st !== "running" && st !== "scheduled") {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(
                            JSON.stringify({
                                ok: false,
                                error: "Only running or scheduled campaigns can be paused",
                            })
                        );
                        return;
                    }
                    list[idx] = { ...camp, state: "paused", updatedAt: nowIso };
                } else {
                    if (st === "running") {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "Campaign is already running" }));
                        return;
                    }
                    if (st === "completed") {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(
                            JSON.stringify({
                                ok: false,
                                error: "Completed campaigns cannot be started",
                            })
                        );
                        return;
                    }
                    list[idx] = {
                        ...camp,
                        state: "running",
                        startMode: "now",
                        scheduledAt: null,
                        endsAt: ensureCampaignEndsAtIso(camp),
                        updatedAt: nowIso,
                    };
                }
                writeCampaignsFile(list);
                if (action === "start") {
                    scheduleCampaignWhatsAppSend(campaignId);
                    console.log(`[campaigns] queued WhatsApp send after start for ${campaignId}`);
                }
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: true, campaign: list[idx] }));
            })
            .catch(() => {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "Invalid JSON body" }));
            });
        return;
    }

    if (campaignByIdPath && req.method === "DELETE") {
        const campaignId = decodeURIComponent(campaignByIdPath[1]);
        const list = readCampaignsFile();
        const next = list.filter((c) => String(c?.id) !== campaignId);
        if (next.length === list.length) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: "Campaign not found" }));
            return;
        }
        writeCampaignsFile(next);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
    }

    if (req.method === "GET" && url.pathname === "/dashboard/rail-stats") {
        const campaigns = withCampaignSendStats(
            normalizeCompletedCampaignStates(readCampaignsFile())
        );
        const summary = computeCampaignSidebarSummary(campaigns);
        const recents = buildRecentActivityItems();
        const recentSentContacts = getRecentSentContactsFromLog(campaigns, 10);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
            JSON.stringify({
                ok: true,
                summary,
                recents,
                recentSentContacts,
                recentSentContactsIsMock: false,
            })
        );
        return;
    }

    if (req.method === "GET" && url.pathname === "/analytics/overview") {
        const overview = computeAnalyticsOverview();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(overview));
        return;
    }

    if (req.method === "GET" && url.pathname === "/leads/stats") {
        const stats = computeLeadsDashboardStats();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, ...stats }));
        return;
    }

    if (req.method === "GET" && url.pathname === "/saved-leads") {
        const leads = readSavedLeadsFile();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, leads }));
        return;
    }

    if (req.method === "POST" && url.pathname === "/saved-leads") {
        readJsonBody(req)
            .then((body) => {
                const category = String(body?.category ?? "").trim();
                const searchPhrase = String(body?.searchPhrase ?? "").trim();
                const country = String(body?.country ?? "").trim().toLowerCase();
                const leads = body?.leads;

                if (!category) {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "Select a category" }));
                    return;
                }

                const known = readCategoriesFile();
                if (!known.some((c) => c.toLowerCase() === category.toLowerCase())) {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(
                        JSON.stringify({
                            ok: false,
                            error: "Unknown category — add it in Settings first",
                        })
                    );
                    return;
                }

                if (!Array.isArray(leads) || leads.length === 0) {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "No leads to save" }));
                    return;
                }

                const savedAt = new Date().toISOString();
                /** @type {object[]} */
                const entries = [];

                for (const item of leads) {
                    const row = item && typeof item === "object" ? item : {};
                    const r = /** @type {Record<string, unknown>} */ (row);
                    const companyName = String(r.businessName ?? "").trim();
                    const contactNumber = String(r.phone ?? "").trim();
                    const email = String(r.email ?? "").trim();
                    if (!companyName && !contactNumber && !email) continue;

                    entries.push({
                        savedAt,
                        category,
                        companyName,
                        contactNumber,
                        email,
                        searchPhrase,
                        country,
                    });
                }

                if (entries.length === 0) {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(
                        JSON.stringify({
                            ok: false,
                            error: "No valid lead rows after filtering",
                        })
                    );
                    return;
                }

                const prevTotal = readSavedLeadsFile().length;
                appendSavedLeadsFile(entries);
                console.log(
                    `[saved-leads] appended ${entries.length} row(s) category=${JSON.stringify(category)} → ${path.relative(__dirname, SAVED_LEADS_FILE)}`
                );

                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(
                    JSON.stringify({
                        ok: true,
                        savedCount: entries.length,
                        totalSaved: prevTotal + entries.length,
                    })
                );
            })
            .catch(() => {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "Invalid JSON body" }));
            });
        return;
    }

    if (req.method === "GET" && url.pathname === "/whatsapp/status") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(whatsappState));
        return;
    }

    if (req.method === "POST" && url.pathname === "/whatsapp/logout") {
        readJsonBody(req)
            .then(async () => {
                try {
                    await whatsappClient.logout();
                } catch (err) {
                    console.error("WhatsApp logout:", err);
                }
                whatsappState = { state: "disconnected", reason: "logged_out" };
                console.log("[whatsapp] logged out");
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: true }));
            })
            .catch(() => {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "Invalid JSON body" }));
            });
        return;
    }

    if (req.method === "GET" && url.pathname === "/email/status") {
        res.writeHead(200, { "Content-Type": "application/json" });
        const payload = {
            connected: Boolean(emailIntegration.connected),
            email: String(emailIntegration.email || ""),
        };
        if (emailIntegration.connected) {
            payload.smtp = {
                host: String(emailIntegration.smtpHost || ""),
                port: Number(emailIntegration.smtpPort) || 587,
                user: String(emailIntegration.smtpUser || ""),
                secure: Boolean(emailIntegration.smtpSecure),
            };
        }
        res.end(JSON.stringify(payload));
        return;
    }

    if (req.method === "POST" && url.pathname === "/email/connect") {
        readJsonBody(req)
            .then((body) => {
                const email = String(body?.email ?? "").trim();
                const smtpHost = String(body?.smtpHost ?? "").trim();
                const smtpPortRaw = body?.smtpPort;
                const smtpPort = smtpPortRaw === undefined || smtpPortRaw === ""
                    ? 587
                    : Number(smtpPortRaw);
                const smtpUser = String(body?.smtpUser ?? "").trim();
                const smtpPassword = String(body?.smtpPassword ?? "");
                const smtpSecure =
                    body?.smtpSecure !== false &&
                    body?.smtpSecure !== "false" &&
                    body?.smtpSecure !== 0;

                if (!email || !smtpHost || !smtpUser || !smtpPassword) {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(
                        JSON.stringify({
                            ok: false,
                            error: "Missing email, SMTP host, SMTP user, or SMTP password",
                        })
                    );
                    return;
                }
                if (!Number.isFinite(smtpPort)) {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "Invalid SMTP port" }));
                    return;
                }

                emailIntegration = {
                    connected: true,
                    email,
                    smtpHost,
                    smtpPort,
                    smtpUser,
                    smtpPassword,
                    smtpSecure,
                };
                console.log(
                    `[email] connected ${email} via ${smtpHost}:${smtpPort} user=${smtpUser}`
                );
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(
                    JSON.stringify({
                        ok: true,
                        connected: true,
                        email,
                        smtp: {
                            host: smtpHost,
                            port: smtpPort,
                            user: smtpUser,
                            secure: smtpSecure,
                        },
                    })
                );
            })
            .catch(() => {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "Invalid JSON body" }));
            });
        return;
    }

    if (req.method === "POST" && url.pathname === "/email/disconnect") {
        readJsonBody(req)
            .then(() => {
                emailIntegration = emptyEmailIntegration();
                console.log("[email] disconnected");
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: true }));
            })
            .catch(() => {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "Invalid JSON body" }));
            });
        return;
    }

    if (req.method === "POST" && url.pathname === "/auth/login") {
        readJsonBody(req)
            .then((body) => {
                const username = String(body?.username ?? "");
                const password = String(body?.password ?? "");

                if (!username || !password) {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "Missing username/password" }));
                    return;
                }

                if (
                    username === ADMIN_USERNAME &&
                    password === ADMIN_PASSWORD
                ) {
                    console.log(`[auth/login] ok user=${username}`);
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: true, user: { name: ADMIN_USERNAME } }));
                    return;
                }

                console.log(`[auth/login] failed user=${username}`);
                res.writeHead(401, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "Invalid credentials" }));
            })
            .catch(() => {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "Invalid JSON body" }));
            });
        return;
    }

    if (req.method === "GET" && url.pathname === "/search/last") {
        const { results, searchPhrase, country } = readLastSearchFile();
        const visibleResults = filterOutAlreadySavedLeads(results);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
            JSON.stringify({
                ok: true,
                results: visibleResults,
                searchPhrase,
                country,
            })
        );
        return;
    }

    if (req.method === "POST" && url.pathname === "/search/places") {
        readJsonBody(req)
            .then(async (body) => {
                const apiKey = String(process.env.SERPER_API_KEY ?? "").trim();
                if (!apiKey) {
                    console.error("[search/places] missing SERPER_API_KEY in environment");
                    res.writeHead(500, { "Content-Type": "application/json" });
                    res.end(
                        JSON.stringify({
                            ok: false,
                            error: "Server is not configured (missing SERPER_API_KEY)",
                        })
                    );
                    return;
                }

                const q = String(body?.q ?? "").trim();
                const gl = String(body?.gl ?? "").trim().toLowerCase();
                const maxPagesRaw = process.env.SERPER_PLACES_MAX_PAGES;
                const maxPages = Math.max(
                    1,
                    Math.min(
                        100,
                        maxPagesRaw === undefined || maxPagesRaw === ""
                            ? 40
                            : Number(maxPagesRaw) || 40
                    )
                );

                if (!q) {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "Missing search phrase (q)" }));
                    return;
                }
                if (!gl || gl.length !== 2) {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(
                        JSON.stringify({
                            ok: false,
                            error: "Select a country (gl must be a 2-letter code)",
                        })
                    );
                    return;
                }

                try {
                    /** @type {{ businessName: string, phone: string, email: string, address: string, website: string }[]} */
                    const merged = [];
                    const seen = new Set();
                    let pagesFetched = 0;
                    /** @type {string} */
                    let stopReason = "";

                    console.log(
                        `[search/places] start q=${JSON.stringify(q)} gl=${gl} maxPages=${maxPages}`
                    );

                    for (let pageNum = 1; pageNum <= maxPages; pageNum += 1) {
                        console.log(`[search/places] fetching Serper page ${pageNum}…`);
                        const upstream = await serperPlacesRequest({
                            apiKey,
                            q,
                            gl,
                            page: pageNum,
                        });

                        if (upstream.status < 200 || upstream.status >= 300) {
                            console.error(
                                `[search/places] upstream HTTP ${upstream.status}`,
                                typeof upstream.data === "object"
                                    ? JSON.stringify(upstream.data).slice(0, 500)
                                    : upstream.data
                            );
                            res.writeHead(502, { "Content-Type": "application/json" });
                            res.end(
                                JSON.stringify({
                                    ok: false,
                                    error: "Places search failed upstream",
                                    status: upstream.status,
                                    details: upstream.data,
                                })
                            );
                            return;
                        }

                        const rawList = extractSerperPlaceList(upstream.data);
                        if (rawList.length === 0) {
                            stopReason =
                                pageNum === 1 ? "no_places_on_first_page" : "no_more_places";
                            console.log(
                                `[search/places] page ${pageNum} empty → stop (${stopReason})`
                            );
                            break;
                        }

                        pagesFetched = pageNum;
                        const batch = normalizeSerperPlaceRows(rawList);
                        let newUnique = 0;
                        for (const row of batch) {
                            const key = placesLeadDedupeKey(row);
                            if (!seen.has(key)) {
                                seen.add(key);
                                merged.push(row);
                                newUnique += 1;
                            }
                        }
                        console.log(
                            `[search/places] page ${pageNum} raw=${rawList.length} afterFilter=${batch.length} newUnique=${newUnique} totalUnique=${merged.length}`
                        );
                    }

                    if (!stopReason && pagesFetched >= maxPages) {
                        stopReason = "hit_max_pages_limit";
                        console.log(
                            `[search/places] reached maxPages=${maxPages} (more results may exist at Serper)`
                        );
                    }

                    console.log(
                        `[search/places] done pagesFetched=${pagesFetched} uniqueResults=${merged.length} stop=${stopReason || "complete"}`
                    );
                    const visibleResults = filterOutAlreadySavedLeads(merged);
                    const filteredOut = merged.length - visibleResults.length;
                    if (filteredOut > 0) {
                        console.log(
                            `[search/places] hidden already-saved leads=${filteredOut} shown=${visibleResults.length}`
                        );
                    }

                    try {
                        saveLastSearchFile(q, gl, visibleResults);
                        appendSearchHistory(q, gl, visibleResults.length, pagesFetched);
                        console.log(
                            `[search/places] saved ${visibleResults.length} row(s) → ${path.relative(__dirname, LAST_SEARCH_FILE)}`
                        );
                    } catch (writeErr) {
                        console.error("[search/places] failed to write lastSearch.json", writeErr);
                    }

                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(
                        JSON.stringify({
                            ok: true,
                            q,
                            gl,
                            pagesFetched,
                            maxPages,
                            results: visibleResults,
                        })
                    );
                } catch (err) {
                    console.error("[search/places] error", err);
                    res.writeHead(500, { "Content-Type": "application/json" });
                    res.end(
                        JSON.stringify({ ok: false, error: "Search request failed" })
                    );
                }
            })
            .catch(() => {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "Invalid JSON body" }));
            });
        return;
    }

    // Serve frontend static build (if present) from the same backend URL.
    if (req.method === "GET" || req.method === "HEAD") {
        const isApiPath =
            url.pathname.startsWith("/search") ||
            url.pathname.startsWith("/campaigns") ||
            url.pathname.startsWith("/messages") ||
            url.pathname.startsWith("/saved-leads") ||
            url.pathname.startsWith("/categories") ||
            url.pathname.startsWith("/whatsapp") ||
            url.pathname === "/dashboard/rail-stats" ||
            url.pathname.startsWith("/analytics") ||
            url.pathname.startsWith("/leads") ||
            url.pathname.startsWith("/profile") ||
            url.pathname.startsWith("/integration") ||
            url.pathname === "/health";

        if (!isApiPath && tryServeFrontendBuildAsset(url.pathname, res)) return;

        if (!isApiPath && fs.existsSync(FRONTEND_INDEX_FILE)) {
            res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
            if (req.method === "HEAD") {
                res.end();
            } else {
                res.end(fs.readFileSync(FRONTEND_INDEX_FILE, "utf8"));
            }
            return;
        }
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "Not found" }));
});

server.listen(PORT, () => {
    console.log(`Backend listening on http://localhost:${PORT}`);
    console.log(
        `[boot] HTTP log mode=${httpLogMode()} quietPaths=${[...HTTP_LOG_QUIET_PATHS].join(",")}`
    );
    console.log(
        "[boot] Set BACKEND_HTTP_LOG=all to log every request (including /whatsapp/status), or BACKEND_HTTP_LOG=0 to disable HTTP lines."
    );
});

// Useful when you Ctrl+C / stop the process.
process.on("SIGINT", () => server.close(() => process.exit(0)));