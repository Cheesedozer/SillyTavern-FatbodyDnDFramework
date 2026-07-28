/**
 * custom-fields-ui.js — Fatbody D&D Framework
 *
 * The custom-field / stock-module editor UI: the row-type <select> builder,
 * the custom-field editor modal, the per-module prompt editor, module
 * import/export + share modal, and the drag-reorderable module/order list.
 * Pure settings UI over getSettings/saveSettings + the renderer helpers.
 * Extracted from index.js; behaviour unchanged.
 */
import { getSettings } from './state-manager.js';
import { parseMemoBlocks, renderMemoAsCards } from './renderer.js';
import { makeDraggable } from './panel-geometry.js';
import { toggleDebugViewer } from './debug-viewer.js';
import { DEFAULT_STOCK_PROMPTS, PAGE_SIZE, BLOCK_ICONS } from './constants.js';
import { BLOCK_ORDER } from './module-registry.js';
import { RT } from './shared-state.js';
import { saveSettings, refreshRenderedView, syncMemoView, updateUIMemo, bindRenderedCardEvents } from './index.js';

    // Row type options shared by both the custom field editor and the global sub-field rules list
    const ROW_TYPE_OPTIONS = [
        ['pills',     'Pills (comma-separated chips)'],
        ['badge',     'Badge (single chip)'],
        ['highlight', 'Highlight (paren emphasis)'],
        ['hp_bar',    'HP Bar (X/Y progress)'],
        ['xp_bar',    'XP Bar (X/Y with optional level)'],
        ['kv',        'Key / Value pair'],
        ['text',      'Plain Text'],
    ];

    export function buildRowTypeSelect(selectedVal) {
        const sel = document.createElement('select');
        sel.className = 'text_pole';
        sel.style.cssText = 'flex:2; min-width:110px; height:28px; padding:2px 4px; font-size:12px;';
        ROW_TYPE_OPTIONS.forEach(([val, label]) => {
            const opt = document.createElement('option');
            opt.value = val; opt.textContent = label;
            if (val === selectedVal) opt.selected = true;
            sel.appendChild(opt);
        });
        return sel;
    }

    export function openCustomFieldEditor(index) {
        const isSmallScreen = window.innerWidth <= 700;
        const s = getSettings();
        const field = s.customFields[index];
        const overlay = document.createElement('div');
        overlay.id = 'rt_cfe_overlay';
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.7);backdrop-filter:blur(2px);z-index:10000000;display:none;align-items:center;justify-content:center;overflow-y:auto;';

        overlay.innerHTML = `
            <div id="rt_cfe_modal" class="popup shadowBase" style="
                width: min(540px, 94vw);
                height: ${isSmallScreen ? '85vh' : 'auto'};
                max-height: ${isSmallScreen ? '90vh' : '850px'};
                margin: auto;
                display: flex;
                flex-direction: column;
                padding: 0;
                overflow: hidden;
            ">
                <div class="popup-header">
                    <h3 class="margin0" style="font-size:14px; flex:1;">Custom Module Editor</h3>
                    <div id="rt_cfe_close" class="popup-close interactable" title="Close"><i class="fa-solid fa-times"></i></div>
                </div>
                <div class="popup-body flex-container flexFlowColumn gap-1" style="padding:10px 14px; overflow-y:auto; flex:1;">
                    <!-- Identity row -->
                    <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
                        <input type="text" id="rt_cfe_icon" class="text_pole" style="width:44px;text-align:center;" title="Icon (emoji)">
                        <input type="text" id="rt_cfe_tag"  class="text_pole" style="width:100px;font-family:monospace;" placeholder="TAG">
                        <input type="text" id="rt_cfe_label" class="text_pole" style="flex:1;min-width:80px;" placeholder="Display label">
                    </div>

                    <!-- Layout Options -->
                    <div style="display:flex; align-items:center; gap:10px; margin-top:4px; padding:2px 4px;">
                        <div style="display:flex; align-items:center; gap:6px;">
                            <span style="font-size:12px; font-weight:bold; opacity:0.8;">Pagination Threshold:</span>
                            <input type="text" inputmode="numeric" pattern="[0-9]*" id="rt_cfe_pagesize" class="text_pole" style="width:50px; height:24px; text-align:center;" min="1" max="99" title="How many items to show before adding page buttons">
                            <span style="font-size:11px; opacity:0.6;">entries</span>
                        </div>
                    </div>

                    <!-- AI Instructions -->
                    <div style="margin-top:12px; padding:10px; background:rgba(0,0,0,0.2); border-radius:8px; border:1px solid rgba(255,255,255,0.05);">
                        <div style="display:flex; align-items:center; gap:6px; margin-bottom:6px;">
                            <i class="fa-solid fa-robot" style="opacity:0.7;"></i>
                            <b style="font-size:12px;">AI Instructions</b>
                        </div>
                        <textarea id="rt_cfe_prompt" class="text_pole" rows="10" style="resize:vertical; width:100%;" placeholder="What should the AI track and in what format? Define the instructions. You can use the box below with the live preview (desktop only for now!) to create and paste a formatting instructions template here.&#10;&#10;Example: Track the Limit Break charge level of the protagonist. Increment Times Used on use; increase level by 1 on each use.&#10;&#10;Format:&#10;[LIMIT BREAK]&#10;((XPBAR)) Limit Break: 10/100 Level 4&#10;Times Used: 3&#10;[/LIMIT BREAK]"></textarea>
                    </div>

                    <!-- Testing Sandbox -->
                    <div style="margin-top:15px;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                             <b style="font-size:13px;">Testing Sandbox (desktop only) <i class="fa-solid fa-circle-question" style="opacity:0.5; cursor:help; font-size:11px;" title="This box is ONLY for testing how the UI renders your formatting. Nothing from this box is sent to the AI. You must manually include any formatting examples in the 'AI Instructions' box above."></i></b>
                        </div>
                        <textarea id="rt_cfe_template" class="text_pole" rows="8" style="resize:vertical; width:100%; font-family:monospace; font-size:12px;" placeholder="Example:\n((PILLS)) Skills: Stealth, Deception\nHP: 10/100"></textarea>
                    </div>
                </div>
                <!-- Footer -->
                <div class="popup-footer flex-container gap-1 justifycontentend" style="padding:8px 14px; border-top:1px solid rgba(255,255,255,0.08); flex-shrink:0;">
                    <button id="rt_cfe_delete" class="menu_button interactable" style="color:#ff5555;font-size:12px;"><i class="fa-solid fa-trash"></i> Delete</button>
                    <button id="rt_cfe_export" class="menu_button interactable" style="font-size:12px;margin-right:auto;" title="Export this module as a shareable code"><i class="fa-solid fa-file-export"></i> Export</button>
                    <button id="rt_cfe_cancel" class="menu_button interactable" style="font-size:12px;">Cancel</button>
                    <button id="rt_cfe_save" class="menu_button interactable" style="font-size:12px;">Save Changes</button>
                </div>
            </div>
            <!-- Floating preview -->
            <div id="rt_cfe_preview" class="rpg-tracker-panel" style="margin:0;display:none;flex-direction:column;cursor:default;height:auto;min-height:44px;width:300px;position:fixed;">
                <div id="rt_cfe_preview_header" class="rpg-tracker-header" style="cursor:move;user-select:none;font-size:0.75em;opacity:0.7;padding:5px 10px;"><i class="fa-solid fa-grip-lines" style="margin-right:6px;"></i>UI Live Preview</div>
                <div id="rt_cfe_preview_view" class="rpg-tracker-render-view"></div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.addEventListener('mousedown', e => e.stopPropagation());
        overlay.addEventListener('click', e => e.stopPropagation());

        const iconEl     = /** @type {HTMLInputElement}    */ (document.getElementById('rt_cfe_icon'));
        const tagEl      = /** @type {HTMLInputElement}    */ (document.getElementById('rt_cfe_tag'));
        const labelEl    = /** @type {HTMLInputElement}    */ (document.getElementById('rt_cfe_label'));
        const templateEl = /** @type {HTMLTextAreaElement} */ (document.getElementById('rt_cfe_template'));
        const promptEl   = /** @type {HTMLTextAreaElement} */ (document.getElementById('rt_cfe_prompt'));
        const previewEl  = document.getElementById('rt_cfe_preview');
        const pageSizeEl = /** @type {HTMLInputElement}    */ (document.getElementById('rt_cfe_pagesize'));

        iconEl.value     = field.icon  || '📄';
        tagEl.value      = field.tag   || '';
        labelEl.value    = field.label || '';
        templateEl.value = field.template || '';
        // Legacy cleanup: clear the old placeholder text if it's stored as a value
        if (field.prompt === 'What should the AI track for this new field? Describe it here.') {
            field.prompt = '';
        }
        promptEl.value   = field.prompt || '';
        pageSizeEl.value = String(s.modulePageSizes?.[field.tag.toUpperCase()] ?? (field.tag.toUpperCase() === 'SPELLS' ? 5 : PAGE_SIZE));

        // ── Live Preview ──
        let _previewDebounce = null;
        let _bgRefreshDebounce = null;
        const schedulePreview = () => {
            clearTimeout(_previewDebounce);
            _previewDebounce = setTimeout(updatePreview, 180);
            clearTimeout(_bgRefreshDebounce);
            _bgRefreshDebounce = setTimeout(refreshRenderedView, 300);
        };

        const renderPreviewInto = (targetEl) => {
            const renderView = targetEl || document.getElementById('rt_cfe_preview_view');
            if (!renderView) return;

            const testContent = templateEl.value || 'Nothing in testing sandbox';
            const previewTag = '__PREVIEW__';
            const fakeMemo = `[${previewTag}]\n${testContent}\n[/${previewTag}]`;

            const ghostField = {
                tag:     previewTag,
                label:   labelEl.value || tagEl.value || 'Preview',
                icon:    iconEl.value || '📄',
                template: templateEl.value,
                prompt:  '',
                enabled: true
            };
            const savedCustomFields = s.customFields;
            s.customFields = [...savedCustomFields, ghostField];
            try {
                renderView.innerHTML = renderMemoAsCards(fakeMemo, previewTag, RT.sectionPages);
                bindRenderedCardEvents(renderView, fakeMemo, true, () => renderPreviewInto(targetEl));
            } finally {
                s.customFields = savedCustomFields;
            }
        };

        const updatePreview = () => renderPreviewInto(null);

        iconEl.addEventListener('input', schedulePreview);
        tagEl.addEventListener('input', schedulePreview);
        labelEl.addEventListener('input', schedulePreview);
        templateEl.addEventListener('input', schedulePreview);
        pageSizeEl.addEventListener('input', () => {
            if (!s.modulePageSizes) s.modulePageSizes = {};
            const val = parseInt(String(pageSizeEl.value), 10);
            if (!isNaN(val) && val >= 1) {
                s.modulePageSizes[tagEl.value.toUpperCase()] = val;
                saveSettings();
                schedulePreview();
            }
        });

        updatePreview();
        overlay.style.display = 'flex';

        const modal = document.getElementById('rt_cfe_modal');
        const previewHeader = (document.getElementById('rt_cfe_preview_header'));

        if (modal && previewEl && previewHeader) {
            const rect = modal.getBoundingClientRect();
            const spaceOnRight = window.innerWidth - rect.right;
            if (spaceOnRight >= 320 && !isSmallScreen) {
                previewEl.style.display = 'flex';
                previewEl.style.left = (rect.right + 20) + 'px';
                previewEl.style.top  = rect.top + 'px';
                // @ts-ignore
                makeDraggable(previewEl, previewHeader);
            }
        }

        const save = () => {
            field.icon  = iconEl.value;
            const newTag = tagEl.value.replace(/[^a-zA-Z0-9_]/g, '').toUpperCase();
            if (!newTag) { toastr['error']('Tag cannot be empty.', 'RPG Tracker'); return; }

            // Save page size
            if (!s.modulePageSizes) s.modulePageSizes = {};
            const ps = parseInt(pageSizeEl.value, 10);
            if (!isNaN(ps) && ps >= 1) {
                s.modulePageSizes[newTag] = ps;
            }
            if (!newTag) { toastr['error']('Tag cannot be empty.', 'RPG Tracker'); return; }
            if (BLOCK_ORDER.includes(newTag)) { toastr['error'](`[${newTag}] is a reserved stock module name.`, 'RPG Tracker'); return; }
            const dup = s.customFields.find((f, i) => i !== index && f.tag.toUpperCase() === newTag);
            if (dup) { toastr['error'](`Tag [${newTag}] is already in use.`, 'RPG Tracker'); return; }

            field.tag      = newTag;
            field.label    = labelEl.value;
            field.template = templateEl.value;
            field.prompt   = promptEl.value;
            delete field.rows;
            delete field.renderType;

            overlay.remove();
            saveSettings();
            refreshOrderList();
            refreshRenderedView();
        };

        const del = () => {
            const tagToDelete = field.tag.toUpperCase();
            if (confirm(`Delete custom module [${tagToDelete}]? This will also remove its data from the current tracker.`)) {
                s.customFields.splice(index, 1);
                if (s.blockOrder) s.blockOrder = s.blockOrder.filter(t => t !== tagToDelete);
                const memoBlocks = parseMemoBlocks(s.currentMemo || '');
                if (memoBlocks[tagToDelete] !== undefined) {
                    delete memoBlocks[tagToDelete];
                    s.currentMemo = Object.entries(memoBlocks).map(([k, v]) => `[${k}]\n${v}\n[/${k}]`).join('\n\n');
                    updateUIMemo(s.currentMemo);
                }
                overlay.remove();
                saveSettings();
                refreshOrderList();
                refreshRenderedView();
            }
        };

        const close = () => overlay.remove();
        document.getElementById('rt_cfe_save').onclick   = save;
        document.getElementById('rt_cfe_delete').onclick = del;
        document.getElementById('rt_cfe_cancel').onclick = close;
        document.getElementById('rt_cfe_close').onclick  = close;
        document.getElementById('rpg-tracker-debug-btn').onclick = () => toggleDebugViewer();
        document.getElementById('rt_cfe_export').onclick = () => exportModules([field]);
    }
    export function openPromptEditor(tag, title, currentText, defaultText, onSave) {
        let overlay = document.getElementById('rt_pe_overlay');

        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'rt_pe_overlay';
            overlay.style.position = 'fixed';
            overlay.style.top = '0';
            overlay.style.left = '0';
            overlay.style.width = '100vw';
            overlay.style.height = '100vh';
            overlay.style.backgroundColor = 'rgba(0,0,0,0.7)';
            overlay.style.zIndex = '10000000';
            overlay.style.display = 'flex';
            overlay.style.alignItems = 'center';
            overlay.style.justifyContent = 'center';
            overlay.innerHTML = `
                <div class="popup shadowBase" style="min-width: 400px; max-width: 600px;">
                    <div class="popup-header">
                        <h3 class="margin0" id="rt_pe_title">Edit Prompt</h3>
                        <div id="rt_pe_close" class="popup-close interactable" title="Close"><i class="fa-solid fa-times"></i></div>
                    </div>
                    <div class="popup-body flex-container flexFlowColumn gap-1" style="padding: 10px;">
                        <!-- Layout Options -->
                        <div style="display:flex; align-items:center; gap:10px; margin-bottom:8px; padding:0 4px;">
                            <div style="display:flex; align-items:center; gap:6px;">
                                <span style="font-size:12px; font-weight:bold; opacity:0.8;">Pagination Threshold:</span>
                                <input type="text" inputmode="numeric" pattern="[0-9]*" id="rt_pe_pagesize" class="text_pole" style="width:50px; height:24px; text-align:center;" min="1" max="99" title="How many items to show before adding page buttons">
                                <span style="font-size:11px; opacity:0.6;">entries</span>
                            </div>
                        </div>
                        <textarea id="rt_pe_text" class="text_pole" rows="10" style="width: 100%; resize: vertical;"></textarea>
                        <div class="flex-container gap-1 justifycontentend">
                            <button id="rt_pe_reset" class="menu_button interactable" style="margin-right: auto;"><i class="fa-solid fa-arrow-rotate-left"></i> Reset</button>
                            <button id="rt_pe_cancel" class="menu_button interactable">Cancel</button>
                            <button id="rt_pe_save" class="menu_button interactable">Save Changes</button>
                        </div>
                    </div>
                </div>
            `;
            document.body.appendChild(overlay);
        }

        const titleEl = document.getElementById('rt_pe_title');
        const textEl = /** @type {HTMLTextAreaElement} */ (document.getElementById('rt_pe_text'));
        const pageSizeEl = /** @type {HTMLInputElement} */ (document.getElementById('rt_pe_pagesize'));
        const saveBtn = document.getElementById('rt_pe_save');
        const resetBtn = document.getElementById('rt_pe_reset');
        const closeBtn = document.getElementById('rt_pe_close');
        const cancelBtn = document.getElementById('rt_pe_cancel');
        
        const s = getSettings();
        pageSizeEl.value = String(s.modulePageSizes?.[tag.toUpperCase()] ?? (tag.toUpperCase() === 'SPELLS' ? 5 : PAGE_SIZE));
        pageSizeEl.addEventListener('input', () => {
            if (!s.modulePageSizes) s.modulePageSizes = {};
            const val = parseInt(String(pageSizeEl.value), 10);
            if (!isNaN(val) && val >= 1) {
                s.modulePageSizes[tag.toUpperCase()] = val;
                saveSettings();
                refreshRenderedView();
            }
        });

        const close = () => { overlay.style.display = 'none'; };

        titleEl.textContent = title;
        textEl.value = currentText;
        overlay.style.display = 'flex';

        const saveHandler = () => {
            if (!s.modulePageSizes) s.modulePageSizes = {};
            const ps = parseInt(String(pageSizeEl.value), 10);
            if (!isNaN(ps) && ps >= 1) {
                s.modulePageSizes[tag.toUpperCase()] = ps;
            }
            saveSettings();
            onSave(textEl.value);
            close();
        };

        const resetHandler = () => {
            if (confirm("Reset this prompt to the factory default?")) {
                textEl.value = defaultText;
            }
        };

        const cleanup = () => {
            saveBtn.removeEventListener('click', saveHandler);
            resetBtn.removeEventListener('click', resetHandler);
            document.getElementById('rt_pe_close').removeEventListener('click', close);
            document.getElementById('rt_pe_cancel').removeEventListener('click', close);
        };

        saveBtn.onclick = saveHandler;
        resetBtn.onclick = resetHandler;
        document.getElementById('rt_pe_close').onclick = close;
        document.getElementById('rt_pe_cancel').onclick = close;
    }


    // ── Module Export / Import ──────────────────────────────────────────────────

    /**
     * Builds the shareable JSON envelope for the given custom field objects
     * and opens the share modal.
     * @param {Array<{icon:string, tag:string, label:string, prompt:string}>} fields
     */
    export function exportModules(fields) {
        const payload = {
            format: 'fatbody-custom-module',
            version: 1,
            exportedAt: new Date().toISOString(),
            modules: fields.map(f => ({
                icon:   f.icon  || '📄',
                tag:    f.tag,
                label:  f.label || f.tag,
                prompt: f.prompt || '',
            })),
        };
        openShareModal(JSON.stringify(payload, null, 2));
    }

    /**
     * Opens a read-only copy-to-clipboard modal with the export JSON.
     * Uses the Termux-safe execCommand fallback (same as sysprompt copy).
     * @param {string} jsonString
     */
    export function openShareModal(jsonString) {
        const { Popup } = SillyTavern.getContext();
        const escaped = jsonString
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
        const content = `
            <div style="display:flex; flex-direction:column; gap:8px; min-width:360px;">
                <p style="margin:0; font-size:12px; opacity:0.7;">
                    Copy this code and share it anywhere. Others can paste it using the <b>Import</b> button.
                </p>
                <textarea id="rt_share_blob" readonly rows="12" class="text_pole"
                    style="font-family:monospace; font-size:11px; resize:vertical; width:100%;"
                >${escaped}</textarea>
                <div style="display:flex; gap:8px;">
                    <button id="rt_share_copy" class="menu_button interactable" style="flex:1;">
                        <i class="fa-solid fa-copy"></i> Copy to Clipboard
                    </button>
                    <button id="rt_share_download" class="menu_button interactable" style="flex:1;">
                        <i class="fa-solid fa-file-download"></i> Export .json
                    </button>
                </div>
            </div>
        `;
        Popup.show.confirm('📤 Share Custom Module', content, {
            okButton: 'Done',
            cancelButton: false,
        });
        // Wire buttons after the popup DOM renders (next tick)
        setTimeout(() => {
            const copyBtn = document.getElementById('rt_share_copy');
            if (copyBtn) {
                copyBtn.addEventListener('click', async () => {
                    try {
                        // Use modern Clipboard API if available and in secure context
                        if (navigator.clipboard && window.isSecureContext) {
                            await navigator.clipboard.writeText(jsonString);
                            toastr['success']('Module code copied to clipboard!', 'Origins RPG Framework');
                            return;
                        }

                        // Fallback for non-secure contexts (HTTP) or older browsers
                        const ta = document.createElement('textarea');
                        ta.value = jsonString;
                        ta.style.position = 'fixed';
                        ta.style.left = '-9999px';
                        ta.style.top = '0';
                        ta.style.opacity = '0';
                        document.body.appendChild(ta);
                        ta.focus();
                        ta.select();
                        ta.setSelectionRange(0, 99999); // Important for mobile

                        const success = document.execCommand('copy');
                        document.body.removeChild(ta);

                        if (success) {
                            toastr['success']('Module code copied to clipboard!', 'Origins RPG Framework');
                        } else {
                            throw new Error('execCommand returned false');
                        }
                    } catch (err) {
                        console.error('[Fatbody Framework] clipboard copy failed:', err);
                        toastr['error']('Could not copy automatically. Please select the text manually.', 'Origins RPG Framework');
                    }
                });
            }

            const downloadBtn = document.getElementById('rt_share_download');
            if (downloadBtn) {
                downloadBtn.addEventListener('click', () => {
                    const blob = new Blob([jsonString], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `fatbody_module_${new Date().getTime()}.json`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                });
            }
        }, 50);
    }

    /**
     * Validates and imports custom modules from a pasted JSON export string.
     * Collects all tag conflicts first, then resolves them with a single prompt.
     * @param {string} jsonString
     */
    export async function importModulesFromJson(jsonString) {
        // Stock module tags — derived from the settings default so they stay in sync
        const STOCK_TAGS = new Set(['COMBAT', 'CHARACTER', 'PARTY', 'INVENTORY', 'ABILITIES', 'SPELLS', 'XP', 'TIME']);

        let parsed;
        try {
            parsed = JSON.parse(jsonString.trim());
        } catch {
            toastr['error']('Invalid JSON. Please paste a valid module export.', 'Origins RPG Framework');
            return;
        }

        if (parsed?.format !== 'fatbody-custom-module' || !Array.isArray(parsed?.modules)) {
            toastr['error']("This doesn't look like a Fatbody module export.", 'Origins RPG Framework');
            return;
        }

        // Normalize and filter out malformed entries
        const incoming = parsed.modules.filter(m => {
            if (!m.tag || typeof m.tag !== 'string') return false;
            m.tag = m.tag.replace(/[^a-zA-Z0-9_]/g, '').toUpperCase();
            return m.tag.length > 0;
        });

        if (incoming.length === 0) {
            toastr['warning']('No valid modules found in the export.', 'Origins RPG Framework');
            return;
        }

        const s = getSettings();
        const existingTags = new Set((s.customFields || []).map(f => f.tag.toUpperCase()));

        // Hard-block stock tag conflicts
        const stockConflicts = incoming.filter(m => STOCK_TAGS.has(m.tag));
        if (stockConflicts.length > 0) {
            toastr['error'](
                `Cannot import: [${stockConflicts.map(m => m.tag).join('], [')}] clash with built-in stock modules.`,
                'Origins RPG Framework'
            );
            return;
        }

        // Collect soft (custom) conflicts and resolve with a single popup
        const softConflicts = incoming.filter(m => existingTags.has(m.tag));
        let overwriteConflicts = false;

        if (softConflicts.length > 0) {
            const { Popup } = SillyTavern.getContext();
            const tagList = softConflicts.map(m => `<b>[${m.tag}]</b>`).join(', ');
            const choice = await Popup.show.confirm(
                '⚠️ Import Conflicts',
                `<p>${softConflicts.length} module(s) already exist: ${tagList}</p><p>What would you like to do?</p>`,
                { okButton: 'Overwrite Existing', cancelButton: 'Skip Conflicts' }
            );
            if (choice === null || choice === undefined) return; // user dismissed
            overwriteConflicts = (choice === 1);
        }

        if (!s.blockOrder) s.blockOrder = ['COMBAT', 'CHARACTER', 'PARTY', 'INVENTORY', 'ABILITIES', 'SPELLS', 'XP', 'TIME'];

        let importedCount = 0;
        for (const m of incoming) {
            const isConflict = existingTags.has(m.tag);
            if (isConflict && !overwriteConflicts) continue;

            const newField = {
                icon:     m.icon  || '📄',
                tag:      m.tag,
                label:    m.label || m.tag,
                prompt:   m.prompt || '',
                template: '',   // sandbox always starts blank
                enabled:  true, // imported modules are active immediately
            };

            if (isConflict) {
                const idx = s.customFields.findIndex(f => f.tag.toUpperCase() === m.tag);
                if (idx !== -1) s.customFields[idx] = newField;
            } else {
                s.customFields.push(newField);
                if (!s.blockOrder.includes(m.tag)) s.blockOrder.push(m.tag);
            }
            importedCount++;
        }

        if (importedCount === 0) {
            toastr['info']('No modules were imported (all conflicts were skipped).', 'Origins RPG Framework');
            return;
        }

        saveSettings();
        refreshOrderList();
        syncMemoView();
        toastr['success'](`Imported ${importedCount} custom module(s).`, 'Origins RPG Framework');
    }

    // ───────────────────────────────────────────────────────────────────────────

    export function refreshOrderList() {
        const s = getSettings();
        const list = document.getElementById('rpg_tracker_order_list');
        if (!list) return;

        list.innerHTML = '';

        const getIcon = (tag) => {
            if (BLOCK_ICONS[tag]) return BLOCK_ICONS[tag];
            const custom = (s.customFields || []).find(f => f.tag.toUpperCase() === tag);
            return custom?.icon || '📄';
        };

        if (!s.blockOrder) s.blockOrder = [...BLOCK_ORDER];

        // --- Sanitization Pass: Ensure unique tags and no stock conflicts ---
        const seenTags = new Set(BLOCK_ORDER);
        (s.customFields || []).forEach(f => {
            let baseTag = f.tag.toUpperCase().replace(/[^A-Z0-9_]/g, '');
            if (!baseTag) baseTag = 'CUSTOM';
            let finalTag = baseTag;
            let counter = 1;
            while (seenTags.has(finalTag)) {
                finalTag = `${baseTag}_${counter++}`;
            }
            if (f.tag !== finalTag) {
                console.log(`[RPG Tracker] Sanitized tag: ${f.tag} -> ${finalTag}`);
                f.tag = finalTag;
            }
            seenTags.add(finalTag);
        });

        // Add any missing tags to blockOrder
        const allCustomTags = (s.customFields || []).map(f => f.tag.toUpperCase());
        [...BLOCK_ORDER, ...allCustomTags].forEach(tag => {
            if (!s.blockOrder.includes(tag)) s.blockOrder.push(tag);
        });

        // Current order, filtered for validity and optional module toggles
        const validCustomTags = new Set(allCustomTags);
        const order = s.blockOrder.filter(tag => {
            const isStock = BLOCK_ORDER.includes(tag);
            if (!isStock && !validCustomTags.has(tag)) return false;

            // Hide QUESTS if disabled in Narrator Config
            if (tag === 'QUESTS' && s.syspromptModules?.quests === false) return false;

            return true;
        });
        s.blockOrder = order;

        order.forEach((tag, index) => {
            const isStock = BLOCK_ORDER.includes(tag);
            const customIndex = s.customFields.findIndex(f => f.tag.toUpperCase() === tag);
            const field = isStock ? null : s.customFields[customIndex];

            const isEnabled = isStock ? (s.modules[tag.toLowerCase()] ?? false) : (field?.enabled ?? false);

            const item = document.createElement('div');
            item.className = 'flex-container gap-1 alignitemscenter rt-order-item';
            item.style.padding = '5px';
            item.style.background = isEnabled ? 'var(--black30a)' : 'transparent';
            item.style.opacity = isEnabled ? '1' : '0.6';
            item.style.borderRadius = '4px';
            item.style.border = '1px solid var(--smartThemeBorderColor)';

            // 1. Checkbox
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = isEnabled;
            cb.style.margin = '0 5px';
            cb.onchange = () => {
                if (isStock) {
                    s.modules[tag.toLowerCase()] = cb.checked;
                } else {
                    field.enabled = cb.checked;
                }
                saveSettings();
                refreshOrderList();
                refreshRenderedView();
            };

            // 2. Label
            const label = document.createElement('span');
            label.style.flex = '1';
            label.style.fontSize = '12px';
            label.style.cursor = 'default';
            label.textContent = `${getIcon(tag)} ${tag}`;

            // 3. Button Group
            const btnGroup = document.createElement('div');
            btnGroup.className = 'flex-container gap-1';

            // Edit Button
            const editBtn = document.createElement('button');
            editBtn.className = 'menu_button interactable rt-order-btn';
            editBtn.style.padding = '2px 6px';
            editBtn.title = isStock ? 'Edit Prompt' : 'Edit Custom Field';
            editBtn.innerHTML = '<i class="fa-solid fa-pen-to-square"></i>';
            editBtn.onclick = () => {
                if (isStock) {
                    let mod = tag.toLowerCase();
                    let displayTag = tag;
                    
                    // Redirect QUESTS to quests_legacy if in legacy mode
                    if (tag === 'QUESTS' && s.questLegacyMode) {
                        mod = 'quests_legacy';
                        displayTag = 'QUESTS (Legacy Mode)';
                    }

                    if (!s.stockPrompts) s.stockPrompts = { ...DEFAULT_STOCK_PROMPTS };
                    openPromptEditor(
                        displayTag,
                        `Edit Default [${displayTag}] Prompt`,
                        s.stockPrompts[mod] || DEFAULT_STOCK_PROMPTS[mod],
                        DEFAULT_STOCK_PROMPTS[mod],
                        (newVal) => {
                            s.stockPrompts[mod] = newVal;
                            saveSettings();
                            toastr['success'](`[${displayTag}] prompt updated.`, 'RPG Tracker');
                        }
                    );
                } else {
                    openCustomFieldEditor(customIndex);
                }
            };

            // Reset Button (Stock only)
            let resetBtn = null;
            if (isStock) {
                resetBtn = document.createElement('button');
                resetBtn.className = 'menu_button interactable rt-order-btn';
                resetBtn.style.padding = '2px 6px';
                resetBtn.title = 'Reset Prompt to Default';
                resetBtn.innerHTML = '<i class="fa-solid fa-rotate-left"></i>';
                resetBtn.onclick = () => {
                    let mod = tag.toLowerCase();
                    if (tag === 'QUESTS' && s.questLegacyMode) mod = 'quests_legacy';
                    
                    if (confirm(`Reset [${tag}] prompt to default? This will lose any custom changes.`)) {
                        if (!s.stockPrompts) s.stockPrompts = { ...DEFAULT_STOCK_PROMPTS };
                        s.stockPrompts[mod] = DEFAULT_STOCK_PROMPTS[mod];
                        saveSettings();
                        toastr['success'](`[${tag}] prompt reset.`, 'RPG Tracker');
                    }
                };
            }

            // Up/Down Arrows
            const upBtn = document.createElement('button');
            upBtn.className = 'menu_button interactable rt-order-btn';
            upBtn.style.padding = '2px 6px';
            upBtn.innerHTML = '<i class="fa-solid fa-arrow-up"></i>';
            upBtn.disabled = index === 0;
            upBtn.onclick = () => {
                const newOrder = [...order];
                [newOrder[index - 1], newOrder[index]] = [newOrder[index], newOrder[index - 1]];
                s.blockOrder = newOrder;
                saveSettings();
                refreshOrderList();
                refreshRenderedView();
            };

            const downBtn = document.createElement('button');
            downBtn.className = 'menu_button interactable rt-order-btn';
            downBtn.style.padding = '2px 6px';
            downBtn.innerHTML = '<i class="fa-solid fa-arrow-down"></i>';
            downBtn.disabled = index === order.length - 1;
            downBtn.onclick = () => {
                const newOrder = [...order];
                [newOrder[index + 1], newOrder[index]] = [newOrder[index], newOrder[index + 1]];
                s.blockOrder = newOrder;
                saveSettings();
                refreshOrderList();
                refreshRenderedView();
            };

            item.appendChild(cb);
            item.appendChild(label);
            btnGroup.appendChild(editBtn);
            if (resetBtn) btnGroup.appendChild(resetBtn);
            btnGroup.appendChild(upBtn);
            btnGroup.appendChild(downBtn);
            item.appendChild(btnGroup);
            list.appendChild(item);
        });
    }
