/**
 * settings-overlay.js — Fatbody Framework (v3.1)
 *
 * The full-screen, PoE-style settings window. The extensions-panel dropdown
 * (settings-stub.html) keeps only the master toggle and quick buttons; every
 * other control lives here, organized into tabs along the left rail.
 *
 * The restructured settings.html is injected into this overlay ONCE at init —
 * before index.js runs its ID-based jQuery bindings — so every existing
 * binding keeps working untouched. The overlay itself only handles chrome:
 * open/close, tab switching, theming, and the background art.
 *
 * Background: a hand-coded SVG scene (a modern soldier with a rifle facing a
 * fire-breathing dragon — D&D mode meets Modern mode). If the user drops their
 * own art at assets/settings-bg.png inside the extension folder, it replaces
 * the SVG automatically.
 *
 * All DOM work happens inside the exported functions (the node smoke test
 * imports this module with only a stubbed document).
 *
 * Imports: env.js, state-manager.js
 * Imported by: index.js (init + Open Settings button)
 */

import { FOLDER_NAME } from './env.js';
import { getSettings } from './state-manager.js';

const TAB_DEFS = [
    { id: 'general', icon: 'fa-gears', label: 'General' },
    { id: 'narrator', icon: 'fa-dice-d20', label: 'Narrator & Quests' },
    { id: 'visuals', icon: 'fa-palette', label: 'Visuals' },
    { id: 'statemodel', icon: 'fa-brain', label: 'State Model' },
    { id: 'agent', icon: 'fa-route', label: 'Lorebook Agent' },
    { id: 'advanced', icon: 'fa-screwdriver-wrench', label: 'Advanced' },
];

let _lastTab = 'general';

/**
 * The background scene: night sky, a ruined ridge, a dragon descending from
 * the upper right breathing fire toward a kneeling modern soldier returning
 * rifle fire from the lower left. Pure silhouette + gradient art so it scales
 * to any viewport and dims cleanly behind the settings panel.
 */
function backgroundSvg() {
    return `
<svg class="rt-so-bg-svg" viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <linearGradient id="rtso-sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#070a14"/>
      <stop offset="0.55" stop-color="#141022"/>
      <stop offset="1" stop-color="#2a1410"/>
    </linearGradient>
    <radialGradient id="rtso-glow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#ff9a2a" stop-opacity="0.55"/>
      <stop offset="0.5" stop-color="#e0561a" stop-opacity="0.28"/>
      <stop offset="1" stop-color="#e0561a" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="rtso-flame" x1="1" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffe066"/>
      <stop offset="0.4" stop-color="#ff9a2a"/>
      <stop offset="1" stop-color="#e0561a" stop-opacity="0.15"/>
    </linearGradient>
    <linearGradient id="rtso-flame-core" x1="1" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff6c8"/>
      <stop offset="1" stop-color="#ffd24d" stop-opacity="0.1"/>
    </linearGradient>
    <filter id="rtso-soft" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="9"/>
    </filter>
  </defs>

  <!-- sky -->
  <rect width="1920" height="1080" fill="url(#rtso-sky)"/>

  <!-- fire glow where breath and gunfire meet -->
  <ellipse cx="980" cy="600" rx="640" ry="420" fill="url(#rtso-glow)"/>

  <!-- dragon breath: roars out of the open jaw (≈1190,400) down toward the ridge,
       widening with ragged flame tongues at the far end -->
  <path d="M1196,386 C1110,392 1010,420 920,470
           C870,498 824,534 786,576
           C806,560 830,552 850,556
           C824,584 800,616 782,652
           C806,634 832,624 854,626
           C826,664 802,706 786,752
           C816,736 850,726 880,724
           C868,748 858,772 852,796
           C920,766 990,724 1050,672
           C1124,608 1180,532 1212,452
           C1216,428 1212,404 1196,386 Z"
        fill="url(#rtso-flame)" opacity="0.85" filter="url(#rtso-soft)"/>
  <path d="M1192,398 C1110,412 1030,446 962,494
           C912,530 868,574 834,624
           C856,612 878,608 896,612
           C872,648 852,688 838,730
           C886,706 934,674 978,634
           C1066,556 1148,478 1196,420 Z"
        fill="url(#rtso-flame-core)" opacity="0.8" filter="url(#rtso-soft)"/>

  <!-- rifle tracer answering up the same diagonal -->
  <line x1="652" y1="652" x2="1148" y2="452" stroke="#ffe9a0" stroke-width="3" opacity="0.65"/>
  <line x1="652" y1="652" x2="980" y2="520" stroke="#fff6c8" stroke-width="1.5" opacity="0.9"/>
  <!-- muzzle flash -->
  <path d="M652,652 l30,-22 -14,18 34,-6 -30,14 22,12 -34,-4 10,20 -22,-22 Z" fill="#ffe066" opacity="0.95"/>

  <!-- embers -->
  <g fill="#ffb347">
    <circle cx="860" cy="430" r="4" opacity="0.8"/>
    <circle cx="990" cy="350" r="3" opacity="0.6"/>
    <circle cx="760" cy="560" r="3" opacity="0.7"/>
    <circle cx="1100" cy="300" r="4" opacity="0.5"/>
    <circle cx="920" cy="640" r="2.5" opacity="0.8"/>
    <circle cx="690" cy="480" r="2" opacity="0.55"/>
    <circle cx="1180" cy="560" r="3" opacity="0.6"/>
    <circle cx="540" cy="520" r="2.5" opacity="0.45"/>
    <circle cx="1040" cy="470" r="2" opacity="0.85"/>
    <circle cx="820" cy="320" r="2.5" opacity="0.4"/>
    <circle cx="1240" cy="640" r="2.5" opacity="0.5"/>
    <circle cx="600" cy="380" r="2" opacity="0.35"/>
  </g>

  <!-- dragon (silhouette, upper right): wing with finger spikes, neck arcing
       down from the corner to a horned, open-jawed head -->
  <g fill="#07080f">
    <!-- wing membrane with finger spikes -->
    <path d="M1500,260 C1530,170 1610,90 1740,40 C1700,110 1680,170 1680,220
             C1740,160 1820,110 1920,80 L1920,140
             C1860,180 1810,225 1780,275
             C1840,255 1900,250 1920,252 L1920,330
             C1850,330 1780,350 1720,390
             C1700,345 1670,310 1630,288
             C1640,330 1638,370 1624,406
             C1600,355 1560,305 1500,260 Z"/>
    <!-- neck from the corner, skull, open jaws, throat back to the right edge -->
    <path d="M1920,150 C1800,170 1700,210 1620,270 C1540,330 1470,360 1400,360
             C1372,330 1372,300 1394,272
             C1352,266 1318,280 1296,310
             C1262,322 1238,344 1226,374
             L1130,400 L1224,408
             C1228,424 1238,438 1254,448
             L1180,530 L1276,476
             C1310,490 1350,496 1394,494
             C1480,560 1600,610 1740,630 L1920,650 Z"/>
    <!-- horns swept back from the skull -->
    <path d="M1390,276 C1430,210 1500,158 1600,130 C1520,200 1470,264 1450,328 Z"/>
    <path d="M1340,290 C1356,242 1390,200 1442,170 C1404,226 1380,278 1370,326 Z"/>
    <!-- brow spike over the eye -->
    <path d="M1300,316 C1280,300 1256,294 1230,298 C1252,310 1268,324 1278,340 Z"/>
  </g>
  <!-- dragon eye -->
  <circle cx="1308" cy="344" r="8" fill="#ffd24d" opacity="0.95"/>
  <!-- fire spilling between the jaws -->
  <path d="M1230,380 C1210,392 1196,406 1188,422 C1212,418 1232,408 1246,394 Z" fill="#ffe066" opacity="0.9"/>

  <!-- ridge / ground -->
  <path d="M0,880 L140,856 L300,876 L420,850 L560,872 L700,840 L840,876 L1000,856 L1180,886 L1320,866 L1500,896 L1680,876 L1920,900 L1920,1080 L0,1080 Z" fill="#04050a"/>

  <!-- soldier (silhouette, kneeling, aiming up-right) -->
  <g fill="#04050a">
    <!-- rifle along the tracer line -->
    <g transform="rotate(-22 520 700)">
      <rect x="408" y="694" width="250" height="13" rx="3"/>
      <rect x="600" y="688" width="44" height="7" rx="2"/>
      <rect x="448" y="704" width="16" height="34" rx="3"/>
      <rect x="498" y="704" width="22" height="26" rx="3"/>
    </g>
    <!-- helmeted head -->
    <ellipse cx="468" cy="640" rx="30" ry="26"/>
    <rect x="438" y="612" width="62" height="16" rx="8"/>
    <!-- torso leaning into the shot, arms forward -->
    <path d="M438,660 C470,652 500,656 522,672 L560,690 L588,672 L600,690 L556,716 L516,704
             C530,740 536,776 532,810 L436,810 C428,760 428,706 438,660 Z"/>
    <!-- kneeling legs: rear knee down, front foot planted -->
    <path d="M444,806 L468,806 C460,840 448,868 430,892 L466,896 L460,920 L388,918 C400,878 416,840 444,806 Z"/>
    <path d="M500,806 L536,806 C548,838 560,866 580,888 L596,920 L516,920 L520,892 C508,866 500,838 500,806 Z"/>
    <!-- backpack -->
    <path d="M428,668 C410,672 400,690 400,712 L402,764 C414,772 426,776 436,774 C428,738 426,702 428,668 Z"/>
  </g>
</svg>`;
}

/**
 * Builds the settings overlay and injects the settings markup into it.
 * Must run BEFORE index.js binds settings controls by ID.
 *
 * @param {string} settingsHtml - rendered settings.html (the tab sections)
 */
export function initSettingsOverlay(settingsHtml) {
    document.getElementById('rt-settings-overlay')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'rt-settings-overlay';
    overlay.className = 'rt-settings-overlay';
    overlay.innerHTML = `
        <div class="rt-so-bg">${backgroundSvg()}</div>
        <div class="rt-so-dim"></div>
        <div class="rt-so-panel">
            <div class="rt-so-header">
                <div class="rt-so-title"><span class="rt-so-title-icon">⚔️</span> Fatbody D&amp;D Framework — Settings</div>
                <button id="rt-so-close" class="menu_button interactable" title="Close (Esc)">✕</button>
            </div>
            <div class="rt-so-body">
                <nav class="rt-so-tabs">
                    ${TAB_DEFS.map(t => `<button class="rt-so-tab-btn" data-tab="${t.id}"><i class="fa-solid ${t.icon}"></i><span>${t.label}</span></button>`).join('')}
                </nav>
                <div class="rt-so-content">${settingsHtml}</div>
            </div>
        </div>`;
    document.body.appendChild(overlay);

    // User-supplied background art beats the built-in SVG when present.
    try {
        const url = `/scripts/extensions/third-party/${FOLDER_NAME}/assets/settings-bg.png`;
        const probe = new Image();
        probe.onload = () => {
            const bg = overlay.querySelector('.rt-so-bg');
            if (bg) {
                bg.innerHTML = '';
                bg.style.backgroundImage = `url("${url}")`;
            }
        };
        probe.src = url;
    } catch (_) { /* keep the SVG */ }

    overlay.querySelectorAll('.rt-so-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => switchTab(overlay, btn.dataset.tab));
    });
    overlay.querySelector('#rt-so-close').addEventListener('click', closeSettingsOverlay);
    // Clicking the dim backdrop (not the panel) closes too.
    overlay.querySelector('.rt-so-dim').addEventListener('click', closeSettingsOverlay);
    // Lookup by id so re-init (double-load guard) never leaves a stale handler
    // pointing at a removed overlay.
    if (!globalThis.__rtSettingsOverlayEscBound) {
        globalThis.__rtSettingsOverlayEscBound = true;
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && document.getElementById('rt-settings-overlay')?.classList.contains('rt-so-open')) {
                closeSettingsOverlay();
            }
        });
    }

    switchTab(overlay, _lastTab);
}

function switchTab(overlay, tabId) {
    if (!TAB_DEFS.some(t => t.id === tabId)) tabId = TAB_DEFS[0].id;
    _lastTab = tabId;
    overlay.querySelectorAll('.rt-so-tab-btn').forEach(b => b.classList.toggle('rt-so-tab-active', b.dataset.tab === tabId));
    overlay.querySelectorAll('.rt-settings-tab').forEach(s => { s.style.display = s.dataset.tab === tabId ? 'block' : 'none'; });
}

export function openSettingsOverlay() {
    const overlay = document.getElementById('rt-settings-overlay');
    if (!overlay) return;
    // Follow the tracker's visual theme so the window matches the panels.
    const theme = getSettings().trackerTheme || 'rt-theme-native';
    overlay.className = `rt-settings-overlay rt-so-open ${theme}`;
    switchTab(overlay, _lastTab);
}

export function closeSettingsOverlay() {
    const overlay = document.getElementById('rt-settings-overlay');
    if (overlay) overlay.classList.remove('rt-so-open');
}
