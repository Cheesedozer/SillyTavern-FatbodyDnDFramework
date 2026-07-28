/**
 * panel-geometry.js — Fatbody D&D Framework
 *
 * Self-contained panel positioning: persisted geometry (localStorage), pointer
 * drag, top-right resize, ResizeObserver autosave, and the delta-pane resizer.
 * No extension state, no settings, no SillyTavern — only the DOM/localStorage.
 * Extracted verbatim from index.js as part of the monolith split.
 */

const GEOMETRY_KEY = 'rpg_tracker_geometry';
const DELTA_HEIGHT_KEY = 'rpg_tracker_delta_height';

/** How much of the panel must stay on screen for saved geometry to be usable. */
const MIN_VISIBLE_PX = 80;

/**
 * A hidden element measures as all-zeros. Saving that would overwrite good geometry
 * with {0,0,0,0} — and because the ResizeObserver fires when the panel is hidden,
 * this used to happen every time the HUD was closed.
 * @param {{ getBoundingClientRect: () => DOMRect }} panel
 * @returns {boolean} true when the rect reflects a real, laid-out element
 */
function hasUsableRect(panel) {
    const rect = panel.getBoundingClientRect();
    return Number.isFinite(rect.width) && Number.isFinite(rect.height)
        && rect.width >= 1 && rect.height >= 1;
}

export function savePanelGeometry(panel) {
    // Never persist a measurement taken while the panel is hidden or unlaid-out.
    if (!hasUsableRect(panel)) return;

    const rect = panel.getBoundingClientRect();
    const isCollapsed = panel.classList.contains('rt-panel-collapsed');
    let savedGeo = {};
    try {
        const savedStr = localStorage.getItem(GEOMETRY_KEY);
        if (savedStr) savedGeo = JSON.parse(savedStr) || {};
    } catch {}

    localStorage.setItem(GEOMETRY_KEY, JSON.stringify({
        left: rect.left, top: rect.top,
        width: isCollapsed ? (savedGeo.width || rect.width) : rect.width,
        height: isCollapsed ? (savedGeo.height || rect.height) : rect.height
    }));
}

/**
 * Forget any saved geometry and strip the inline positioning, so the panel falls
 * back to its stylesheet defaults (top: 100px; right: 20px). The escape hatch for
 * a panel that has been stranded off-screen or shrunk to nothing.
 * @param {HTMLElement} [panel]
 */
export function resetPanelGeometry(panel) {
    try { localStorage.removeItem(GEOMETRY_KEY); } catch {}
    if (!panel || !panel.style) return;
    for (const prop of ['left', 'top', 'right', 'bottom', 'width', 'height']) {
        panel.style[prop] = '';
    }
}

/**
 * @param {HTMLElement} panel
 */
export function loadPanelGeometry(panel) {
    try {
        const saved = JSON.parse(localStorage.getItem(GEOMETRY_KEY));
        if (!saved) return;

        // Sanitize coordinates to prevent "bricking" off-screen. Non-finite values must be
        // dropped rather than clamped: Math.max(0, Math.min(w, NaN)) is NaN, which makes the
        // left/top declarations invalid while right/bottom have already been set to 'auto' —
        // the fixed-position panel then has no anchor at all and renders nowhere useful.
        const clamp = (value, limit) => (
            Number.isFinite(value) ? Math.max(0, Math.min(limit - MIN_VISIBLE_PX, value)) : undefined
        );
        const left = clamp(saved.left, window.innerWidth);
        const top = clamp(saved.top, window.innerHeight);

        if (left !== undefined) { panel.style.left = left + 'px'; panel.style.right = 'auto'; }
        if (top !== undefined) { panel.style.top = top + 'px'; panel.style.bottom = 'auto'; }
        // Guard: ignore saved widths/heights smaller than the panel's own minimums (e.g. a
        // stale save from before this floor existed). 220 matches min-width (style.css) and
        // the live top-right resize clamp (makeResizableTR below); 80px ≈ header + tiny content.
        if (saved.width && saved.width > 220) panel.style.width = saved.width + 'px';
        if (saved.height && saved.height > 80) panel.style.height = saved.height + 'px';
    } catch { /* ignore */ }
}

export function saveDeltaHeight(height) {
    localStorage.setItem(DELTA_HEIGHT_KEY, String(height));
}

export function loadDeltaHeight() {
    const v = parseInt(localStorage.getItem(DELTA_HEIGHT_KEY) || '');
    return isNaN(v) ? 120 : Math.max(40, v);
}

export function makeDraggable(panel, handle, customKey = null) {
    let isDragging = false;
    let startX, startY, startLeft, startTop;

    const onPointerDown = (e) => {
        if (e.button !== 0) return;
        // Ignore clicks on buttons inside the header
        if (e.target instanceof Element && e.target.closest('button, input, select, textarea')) return;
        isDragging = true;
        handle.setPointerCapture(e.pointerId);
        const rect = panel.getBoundingClientRect();
        startX = e.clientX; startY = e.clientY;
        startLeft = rect.left; startTop = rect.top;
        panel.style.left = startLeft + 'px';
        panel.style.top = startTop + 'px';
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
        e.preventDefault();
    };

    const onPointerMove = (e) => {
        if (!isDragging) return;
        const left = startLeft + (e.clientX - startX);
        const top = startTop + (e.clientY - startY);

        // Constrain to viewport (ensure header stays reachable)
        const boundedLeft = Math.max(0, Math.min(window.innerWidth - 100, left));
        const boundedTop = Math.max(0, Math.min(window.innerHeight - 50, top));

        panel.style.left = boundedLeft + 'px';
        panel.style.top = boundedTop + 'px';
    };

    const onPointerUp = () => {
        if (isDragging) {
            isDragging = false;
            if (customKey) {
                const rect = panel.getBoundingClientRect();
                const isCollapsed = panel.classList.contains('rt-panel-collapsed');
                let savedGeo = {};
                try {
                    const savedStr = localStorage.getItem(customKey);
                    if (savedStr) savedGeo = JSON.parse(savedStr) || {};
                } catch {}

                localStorage.setItem(customKey, JSON.stringify({
                    left: rect.left, top: rect.top,
                    width: isCollapsed ? (savedGeo.width || rect.width) : rect.width,
                    height: isCollapsed ? (savedGeo.height || rect.height) : rect.height
                }));
            } else {
                savePanelGeometry(panel);
            }
        }
    };

    handle.addEventListener('pointerdown', onPointerDown);
    handle.addEventListener('pointermove', onPointerMove);
    handle.addEventListener('pointerup', onPointerUp);
    handle.addEventListener('pointercancel', () => { isDragging = false; });

    return () => {
        isDragging = false;
        handle.removeEventListener('pointerdown', onPointerDown);
        handle.removeEventListener('pointermove', onPointerMove);
        handle.removeEventListener('pointerup', onPointerUp);
    };
}

/**
 * Top-Right corner resizer logic
 * @param {HTMLElement} panel
 * @param {HTMLElement} handle
 */
export function makeResizableTR(panel, handle) {
    let startX, startY, startWidth, startHeight, startTop, startLeft;

    handle.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        handle.setPointerCapture(e.pointerId);
        const rect = panel.getBoundingClientRect();
        startX = e.clientX;
        startY = e.clientY;
        startWidth = rect.width;
        startHeight = rect.height;
        startTop = rect.top;
        startLeft = rect.left;

        panel.style.left = startLeft + 'px';
        panel.style.top = startTop + 'px';
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';

        e.preventDefault();
        e.stopPropagation();
    });

    handle.addEventListener('pointermove', (e) => {
        if (!handle.hasPointerCapture(e.pointerId)) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        const newWidth = Math.max(220, startWidth + dx);
        const newHeight = Math.max(200, startHeight - dy);
        const newTop = startTop + dy;

        panel.style.width = newWidth + 'px';
        if (newHeight > 200) {
            panel.style.height = newHeight + 'px';
            panel.style.top = newTop + 'px';
        }
    });

    handle.addEventListener('pointerup', (e) => {
        if (handle.hasPointerCapture(e.pointerId)) {
            savePanelGeometry(panel);
        }
    });

    handle.addEventListener('pointercancel', () => {});
}

export function setupResizeObserver(panel) {
    // Debounced save on resize
    let _resizeTimer;
    const ro = new ResizeObserver(() => {
        clearTimeout(_resizeTimer);
        _resizeTimer = setTimeout(() => savePanelGeometry(panel), 300);
    });
    ro.observe(panel);
}

export function setupDeltaResize(panel) {
    const handle = /** @type {HTMLElement} */ (panel.querySelector('#rpg-tracker-delta-handle'));
    const deltaEl = /** @type {HTMLElement} */ (panel.querySelector('#rpg-tracker-delta'));
    let startY, startH;

    handle.addEventListener('pointerdown', (e) => {
        startY = e.clientY;
        startH = deltaEl.offsetHeight;
        handle.setPointerCapture(e.pointerId);
        e.preventDefault();
    });

    handle.addEventListener('pointermove', (e) => {
        if (!handle.hasPointerCapture(e.pointerId)) return;
        const newH = Math.max(40, startH - (e.clientY - startY));
        deltaEl.style.height = newH + 'px';
    });

    handle.addEventListener('pointerup', (e) => {
        if (handle.hasPointerCapture(e.pointerId)) {
            saveDeltaHeight(deltaEl.offsetHeight);
        }
    });

    handle.addEventListener('pointercancel', () => {});
}
