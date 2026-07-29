/**
 * state-pass.js — Fatbody D&D Framework
 *
 * The State Model pass: takes narrative output, asks the tracker model for a
 * memo update, merges it, recomputes the delta/quests, and refreshes the UI.
 * Also the level-up system message and the direct-instruction path (onboarding /
 * manual corrections). Extracted from index.js; behaviour unchanged.
 *
 * index.js keeps the globalThis._rpgRunStateModelPass bridge (re-exported here),
 * so narrative-hooks.js's interceptor path is unaffected.
 */
import { getSettings, getEffectiveRouterCampaignPrefix, getCampaignMode } from './state-manager.js';
import { sendStateRequest } from './llm-client.js';
import { buildLorebookContext, buildModulesInstructionText, cleanToolCallMessage, commitMemoToChatState, computeDelta, mergeMemo, parseQuestsFromMemo, parseXpFromMemo, syncQuestsFromMemo, writeQuestsToMemo, writeXpLineToMemo } from './memo-processor.js';
import { detectLevelUp, formatXpLine, levelForXp } from './progression-engine.js';
import { ensureTierPregenerated } from './skill-forge.js';
import { stripMemoHtml } from './renderer.js';
import { checkQuestDeadlines } from './quests.js';
import { buildAuditChunks } from './audit-chunker.js';
import { applyOriginCanon } from './origins-engine.js';
import { RT } from './shared-state.js';
import { saveSettings, syncMemoView, updateUIMemo, updateStatusIndicator, refreshRenderedView } from './index.js';

    /** The chat currently active in the SillyTavern UI (or null). */
    function activeChatIdNow() {
        return (typeof globalThis._rpgCurrentChatId === 'function'
            ? globalThis._rpgCurrentChatId()
            : SillyTavern.getContext().chatId) || null;
    }

    export async function runStateModelPass(narrativeOutput, isFullContext = false, overrideLookback = null) {
        const settings = getSettings();
        // Captured NOW: the user may switch chats while the LLM generates. The
        // pass must merge against — and commit into — the chat it started on.
        const passChatId = activeChatIdNow();
        const passMemo = settings.currentMemo;

        // Deterministic logic: Auto-fail quests past deadline (if not using frustration)
        checkQuestDeadlines();

        const { generateRaw } = SillyTavern.getContext();

        if (!generateRaw) {
            console.error("[RPG Tracker] generateRaw not found in context.");
            return;
        }

        try {
            RT.stateModelRunning = true;
            updateStatusIndicator('running');

            // Abort previous if any
            if (RT.stateController) RT.stateController.abort();
            RT.stateController = new AbortController();
            const signal = RT.stateController.signal;

            const modulesText = buildModulesInstructionText(settings);

            let systemPrompt = settings.systemPromptTemplate.replace("{{modulesText}}", modulesText);
            if (isFullContext) {
                systemPrompt = systemPrompt
                    .replace(/Only output sections that actually changed/gi, "Perform a full audit of the narrative history and output the COMPLETE state for all enabled modules")
                    .replace(/Omit unchanged sections entirely/gi, "Do NOT omit any section; output a complete, verified state memo");
            }

            const worldLore = await buildLorebookContext();
            const worldLoreSection = worldLore ? worldLore + '\n\n' : '';

            const { chat } = SillyTavern.getContext();
            // overrideLookback comes from the Lookback Update menu; it wins over settings
            const N = overrideLookback !== null ? overrideLookback
                    : isFullContext          ? chat.length
                    : (settings.lookbackMessages !== undefined ? settings.lookbackMessages : 2);
            const recentChat = chat.slice(-N);
            const chatLog = recentChat
                .map(m => {
                    const name = m.is_user ? 'Player' : (m.name || 'Narrator');
                    // Returns null for tool-call messages — excluded from state model context
                    const content = cleanToolCallMessage(m.mes || m['content'] || '');
                    if (content === null) return null;
                    return `${name}: ${content}`;
                })
                .filter(line => line !== null)
                .join('\n\n');

            let priorMemoText = `## TRACKER STATE 0 (Current)\n${stripMemoHtml(passMemo)}\n\n`;
            const historyCount = (settings.trackerHistoryCount || 1) - 1;
            if (historyCount > 0 && settings.memoHistory && settings.memoHistory.length > 0) {
                const historyToInclude = settings.memoHistory.slice(0, historyCount).reverse();
                const historyString = historyToInclude.map((memo, i) => {
                    const offset = -(historyToInclude.length - i);
                    return `## TRACKER STATE ${offset}\n${stripMemoHtml(memo)}`;
                }).join('\n\n');
                priorMemoText = historyString + '\n\n' + priorMemoText;
            }

            let userPrompt = "";

            if (isFullContext) {
                userPrompt =
                    worldLoreSection +
                    priorMemoText +
                    `## NARRATIVE HISTORY (Last ${recentChat.length} messages)\n${chatLog}\n\n` +
                    `## TASK\nAnalyze the entire narrative history provided above. Rebuild the State Memo to ensure every detail (HP, AC, Inventory, Abilities, XP, Party members) is perfectly accurate to the current moment in the story. Correct any errors or omissions found in the Prior Memo.\n\n` +
                    `## OUTPUT THE COMPLETE VERIFIED STATE MEMO:`;
            } else {
                userPrompt =
                    worldLoreSection +
                    priorMemoText +
                    `## NARRATIVE HISTORY (Last ${recentChat.length} messages)\n${chatLog}\n\n` +
                    `## OUTPUT ONLY CHANGED SECTIONS:`;
            }

            const result = await sendStateRequest(settings, systemPrompt, userPrompt, signal);
            if (result && typeof result === 'string') {
                if (settings.debugMode) console.log("[RPG Tracker] Raw Result:", result);

                // ── Pre-clean: strip <memo> wrapper tags before any merge logic ──
                // The model may wrap its output in <memo>...</memo> regardless of our prompt.
                // We extract the last complete block's content, or strip orphaned tags.
                let cleanedOutput = result;
                const memoBlocks = [...result.matchAll(/<memo>([\s\S]*?)<\/memo>/gi)];
                if (memoBlocks.length > 0) {
                    // Take the last complete <memo>...</memo> block
                    cleanedOutput = memoBlocks[memoBlocks.length - 1][1].trim();
                } else {
                    // Strip any orphaned <memo> / </memo> tags
                    cleanedOutput = result.replace(/<\/?memo>/gi, '').trim();
                }

                // Also sanitize the stored memo in case it was previously
                // contaminated by a prior session that saved raw tags. This is
                // the pass-start snapshot, NOT settings.currentMemo: after a
                // mid-generation chat switch the live memo belongs to another
                // chat, and merging against it would cross-contaminate.
                const sanitizedCurrent = passMemo.replace(/<\/?memo>/gi, '').trim();

                let merged = mergeMemo(sanitizedCurrent, cleanedOutput);

                if (settings.debugMode) {
                    console.log(`[RPG Tracker] Memo ${merged !== sanitizedCurrent ? 'updated (partial merge)' : 'unchanged'}.`);
                }

                return commitStatePassResult({ settings, passChatId, sanitizedBase: sanitizedCurrent, merged });
            }
        } catch (error) {
            if (error.name === 'AbortError') {
                if (settings.debugMode) console.log("[RPG Tracker] State Model pass aborted by user.");
                return;
            }
            console.error("[RPG Tracker] State Model pass failed:", error);
        } finally {
            RT.stateModelRunning = false;
            RT.stateController = null;
            updateStatusIndicator('active');
        }
    }

    /**
     * Commits a completed state-pass result: quest flush, modern progression,
     * Linear Stone history archival, delta panel, quest cache, UI refresh, and
     * the cross-chat late-commit guard. Extracted from runStateModelPass so the
     * chunked audit can merge per chunk but commit exactly once at the end.
     * @param {object} args
     * @param {ReturnType<typeof getSettings>} args.settings
     * @param {string|null} args.passChatId - chat the pass STARTED on
     * @param {string} args.sanitizedBase - memo snapshot from pass start (pre-state archived to history)
     * @param {string} args.merged - merged result memo
     * @returns {string} the computed delta HTML
     */
    function commitStatePassResult({ settings, passChatId, sanitizedBase, merged }) {
        // Push snapshot to rolling history
        const delta = computeDelta(sanitizedBase, merged);

        // Flush any quests staged by LogQuest during this generation.
        // We do this BEFORE pushing to history so the NEW state in history includes the quest.
        if (globalThis._rpgPendingQuests && globalThis._rpgPendingQuests.length) {
            const existingQuests = parseQuestsFromMemo(merged);
            existingQuests.push(...globalThis._rpgPendingQuests);
            merged = writeQuestsToMemo(existingQuests, merged);
            const count = globalThis._rpgPendingQuests.length;
            globalThis._rpgPendingQuests = [];
            if (settings.debugMode) console.log(`[RPG Tracker] Flushed ${count} pending quest(s) into merged memo.`);
        }

        // Modern mode: threshold detection + XP-line normalization (engine truth).
        // Must run before history archival so snapshots carry the corrected line.
        merged = applyModernProgression(settings, merged, passChatId);

        // Origins: same treatment for [ORIGIN] — also before archival, so a
        // rollback can never restore a snapshot carrying rewritten canon.
        merged = applyOriginCanon(settings, merged, passChatId);

        // Late completion after a chat switch: the live globals now
        // belong to ANOTHER chat. Commit the result into the pass
        // chat's saved state instead of corrupting the active chat's.
        if (settings.chatLinkEnabled && passChatId && passChatId !== activeChatIdNow()) {
            const passState = settings.chatStates?.[passChatId];
            if (passState) {
                commitMemoToChatState(passState, sanitizedBase, merged, delta);
                SillyTavern.getContext().saveSettingsDebounced();
                toastr['info']('Tracker pass finished after you switched chats — the result was saved to its own chat.', 'RPG Tracker');
            } else {
                console.warn(`[RPG Tracker] Late state pass for unsaved chat "${passChatId}" — result dropped.`);
            }
            return delta;
        }

        // Linear Stone History Logic:
        // 1. If we were viewing/committed to a past state, delete the "abandoned" future.
        if (settings.historyIndex !== undefined && settings.historyIndex !== -1) {
            if (settings.debugMode) console.log(`[RPG Tracker] Splicing history at index ${settings.historyIndex} due to new update.`);
            settings.memoHistory = settings.memoHistory.slice(settings.historyIndex);
        }

        // 2. Archive the state BEFORE this generation to history
        if (settings.memoHistory[0] !== sanitizedBase) {
            settings.memoHistory.unshift(sanitizedBase);
        }

        // 3. Archive the NEW state so it's always recoverable via navigation
        settings.memoHistory.unshift(merged);
        if (settings.memoHistory.length > 1000) settings.memoHistory.length = 1000;

        // 4. Set pointer to the NEW state (the live stone)
        settings.historyIndex = 0;
        RT.historyViewIndex = -1;

        // Persist delta and update panel
        settings.lastDelta = delta;
        const deltaPanel = document.getElementById('rpg-tracker-delta-content');
        if (deltaPanel) deltaPanel.innerHTML = delta;

        // Rotation logic (legacy compat)
        settings.prevMemo2 = settings.prevMemo1;
        settings.prevMemo1 = sanitizedBase;
        settings.currentMemo = merged;

        // Sync internal quest cache from the merged memo (legacy compat)
        syncQuestsFromMemo(merged);

        updateUIMemo(merged);
        syncMemoView(); // syncMemoView() already calls refreshRenderedView() at its end
        saveSettings();

        if (settings.debugMode) console.log("[RPG Tracker] State Model pass complete.");

        // Check for Level Up
        if (/LEVEL_UP=true/i.test(merged)) {
            handleLevelUp();
        }

        return delta;
    }

    /**
     * Sequential chunked Full Context Audit. Used when the chat history exceeds
     * the per-chunk token budget: each chunk gets a full-output state pass and
     * the merged memo is carried forward as the input state for the next chunk
     * ("the memo IS the rolling summary"), with the UI memo repainted live per
     * chunk. Exactly ONE pre-state + ONE final snapshot enter memoHistory, via
     * commitStatePassResult at the end — partial progress is committed the same
     * way on abort or repeated chunk failure.
     * @param {Array<{text:string,startIndex:number,endIndex:number,messageCount:number,tokens:number}>|null} [prebuiltChunks]
     *        chunks already built by the pre-flight dialog; rebuilt here when null
     */
    export async function runChunkedStateAudit(prebuiltChunks = null) {
        const settings = getSettings();
        if (RT.stateModelRunning) {
            toastr['info']('State Model is already running. Please wait.', 'RPG Tracker');
            return;
        }
        const passChatId = activeChatIdNow();
        const passMemo = settings.currentMemo;

        // Deterministic logic: Auto-fail quests past deadline (if not using frustration)
        checkQuestDeadlines();

        const { chat } = SillyTavern.getContext();
        const chunks = prebuiltChunks || buildAuditChunks(chat, settings.auditChunkTokens || 6000);
        if (chunks.length === 0) {
            toastr['info']('Nothing to audit: the chat has no usable narrative messages.', 'RPG Tracker');
            return;
        }

        try {
            RT.stateModelRunning = true;
            updateStatusIndicator('running');

            // Abort previous if any
            if (RT.stateController) RT.stateController.abort();
            RT.stateController = new AbortController();
            const signal = RT.stateController.signal;

            const modulesText = buildModulesInstructionText(settings);
            const systemPrompt = settings.systemPromptTemplate.replace("{{modulesText}}", modulesText)
                .replace(/Only output sections that actually changed/gi, "Perform a full audit of the narrative history and output the COMPLETE state for all enabled modules")
                .replace(/Omit unchanged sections entirely/gi, "Do NOT omit any section; output a complete, verified state memo");

            const worldLore = await buildLorebookContext();
            const worldLoreSection = worldLore ? worldLore + '\n\n' : '';

            const sanitizedStart = (passMemo || '').replace(/<\/?memo>/gi, '').trim();
            let runningMemo = sanitizedStart;
            let completed = 0;
            let aborted = false;

            for (let i = 0; i < chunks.length; i++) {
                const chunk = chunks[i];
                const userPrompt =
                    worldLoreSection +
                    `## TRACKER STATE 0 (Current)\n${stripMemoHtml(runningMemo)}\n\n` +
                    `## NARRATIVE HISTORY (PART ${i + 1} of ${chunks.length}, messages ${chunk.startIndex + 1}–${chunk.endIndex + 1})\n${chunk.text}\n\n` +
                    `## TASK\nAnalyze the narrative history provided above. Rebuild the State Memo to ensure every detail (HP, AC, Inventory, Abilities, XP, Party members) is perfectly accurate to the current moment in the story. Correct any errors or omissions found in the Prior Memo. This is part ${i + 1} of ${chunks.length} of a longer history; output the COMPLETE state as of the END of this part.\n\n` +
                    `## OUTPUT THE COMPLETE VERIFIED STATE MEMO:`;

                // One retry per chunk; abort or a second failure stops the audit
                // with partial progress (everything merged so far still commits).
                let result = null;
                for (let attempt = 0; attempt < 2 && !result && !aborted; attempt++) {
                    try {
                        const r = await sendStateRequest(settings, systemPrompt, userPrompt, signal);
                        if (r && typeof r === 'string') result = r;
                        else if (attempt === 0) console.warn(`[RPG Tracker] Audit chunk ${i + 1}/${chunks.length} returned no text; retrying once.`);
                    } catch (err) {
                        if (err?.name === 'AbortError' || signal.aborted) { aborted = true; break; }
                        if (attempt === 0) console.warn(`[RPG Tracker] Audit chunk ${i + 1}/${chunks.length} failed; retrying once.`, err);
                        else console.error(`[RPG Tracker] Audit chunk ${i + 1}/${chunks.length} failed twice; stopping with partial progress.`, err);
                    }
                }
                if (!result) break;

                // ── Pre-clean: strip <memo> wrapper tags before any merge logic ──
                let cleanedOutput = result;
                const memoBlocks = [...result.matchAll(/<memo>([\s\S]*?)<\/memo>/gi)];
                if (memoBlocks.length > 0) {
                    cleanedOutput = memoBlocks[memoBlocks.length - 1][1].trim();
                } else {
                    cleanedOutput = result.replace(/<\/?memo>/gi, '').trim();
                }

                runningMemo = mergeMemo(runningMemo, cleanedOutput);
                completed++;

                // Live repaint only — settings.currentMemo/memoHistory are not
                // touched until the single final commit. Skip the paint if the
                // user switched chats (the live UI belongs to another chat now).
                if (passChatId === activeChatIdNow()) {
                    updateUIMemo(runningMemo);
                }
                toastr['info'](`Audit chunk ${i + 1}/${chunks.length} merged.`, 'RPG Tracker');
            }

            if (completed > 0) {
                const delta = commitStatePassResult({ settings, passChatId, sanitizedBase: sanitizedStart, merged: runningMemo });
                if (completed === chunks.length) {
                    toastr['success'](`Full Context Audit complete (${chunks.length} chunks).`, 'RPG Tracker');
                } else {
                    toastr['warning'](`Audit ${aborted ? 'cancelled' : 'stopped'} early — partial result committed (${completed}/${chunks.length} chunks).`, 'RPG Tracker');
                }
                return delta;
            }
            if (aborted) {
                toastr['info']('Audit cancelled before any chunk completed.', 'RPG Tracker');
            } else {
                toastr['error']('Audit failed before any chunk completed. See console for details.', 'RPG Tracker');
            }
        } catch (error) {
            if (error.name === 'AbortError') {
                if (settings.debugMode) console.log("[RPG Tracker] Chunked audit aborted by user.");
                return;
            }
            console.error("[RPG Tracker] Chunked audit failed:", error);
        } finally {
            RT.stateModelRunning = false;
            RT.stateController = null;
            updateStatusIndicator('active');
        }
    }

    /**
     * Modern-mode progression step, run on every merged memo (no-op for D&D
     * chats). This is the v3.0 "level-up inversion": the narrator only awards
     * XP inline; JS owns the thresholds.
     *
     * 1. Parse the cumulative XP from the merged [XP] block.
     * 2. Detect threshold crossings (progression-engine), award skill points,
     *    and stage `pendingLevelUp` — the interceptor injects the
     *    [SYSTEM DIRECTIVE: LEVEL UP ...] on the next generation.
     * 3. Normalize the [XP] line to engine truth (level + next-threshold),
     *    so extractor drift can shift pacing slightly but never skip or
     *    duplicate a level-up.
     *
     * @param {ReturnType<typeof getSettings>} settings
     * @param {string} merged - merged memo text
     * @param {string|null} [passChatId] - chat the pass STARTED on. Callers must
     *        capture it at pass start: resolving the chat here would target
     *        whatever chat the user switched to while the LLM was generating.
     * @returns {string} memo with the normalized [XP] line
     */
    export function applyModernProgression(settings, merged, passChatId = null) {
        try {
            const chatId = passChatId || (typeof globalThis._rpgCurrentChatId === 'function'
                ? globalThis._rpgCurrentChatId()
                : SillyTavern.getContext().chatId);
            if (!chatId || getCampaignMode(chatId) !== 'modern') return merged;

            const prog = settings.chatStates?.[chatId]?.progression;
            if (!prog) return merged;

            const parsed = parseXpFromMemo(merged);
            if (parsed && Number.isFinite(parsed.cur)) {
                const prevXp = prog.xp || 0;
                // XP only ever accrues — extractor regressions (re-emitting an old
                // line, dropping a digit) are ignored in favor of engine truth.
                if (parsed.cur > prevXp) {
                    const up = detectLevelUp(prevXp, parsed.cur);
                    prog.xp = parsed.cur;
                    if (up) {
                        prog.level = up.toLevel;
                        if (!prog.skillPoints) prog.skillPoints = { earned: 0, spent: 0 };
                        prog.skillPoints.earned += up.points;
                        prog.pendingLevelUp = {
                            toLevel: up.toLevel,
                            points: up.points,
                            milestone: up.milestone,
                            delivered: false,
                        };
                        toastr['success'](
                            `Level ${up.toLevel}${up.milestone ? ' — milestone!' : ''} (+${up.points} skill points)`,
                            'RPG Tracker',
                        );
                    }
                    // Fire-and-forget: pre-forge the next skill tier in the background
                    // while the player keeps playing (never blocks a turn).
                    void ensureTierPregenerated(chatId);
                } else {
                    prog.level = levelForXp(prog.xp || 0);
                }
            }

            // Normalize the XP line to engine truth on every pass.
            return writeXpLineToMemo(merged, formatXpLine(prog.xp || 0));
        } catch (e) {
            console.warn('[RPG Tracker] Modern progression step failed open:', e);
            return merged;
        }
    }

    export function handleLevelUp() {
        const { sendSystemMessage } = SillyTavern.getContext();
        toastr['success']("Level Up Detected! System prompt injected.", "RPG Tracker");

        if (sendSystemMessage) {
            sendSystemMessage('generic', "SYSTEM: Level Up Detected! The character has gained a level. Acknowledge this immediately and prompt the user to make their level-up choices or grant them their logical boons.");
        }
    }

    /**
     * Send a direct instruction to the State Model bypassing the narrative pipeline.
     * Used for initial character setup and manual corrections.
     */
    export async function sendDirectPrompt(message) {
        if (RT.stateModelRunning) {
            toastr['info']('State Model is already running. Please wait.', 'RPG Tracker');
            return;
        }

        const settings = getSettings();
        const { generateRaw } = SillyTavern.getContext();
        if (!generateRaw) return;
        // Captured at start — progression must target the chat this prompt
        // belongs to even if the user switches chats during generation.
        const passChatId = (typeof globalThis._rpgCurrentChatId === 'function'
            ? globalThis._rpgCurrentChatId()
            : SillyTavern.getContext().chatId) || null;

        try {
            RT.stateModelRunning = true;
            updateStatusIndicator('running');

            // Abort previous if any
            if (RT.stateController) RT.stateController.abort();
            RT.stateController = new AbortController();
            const signal = RT.stateController.signal;
            const worldLore = await buildLorebookContext();
            const worldLoreSection = worldLore ? worldLore + '\n\n' : '';

            const modulesText = buildModulesInstructionText(settings);
            const systemPrompt = settings.systemPromptTemplate.replace('{{modulesText}}', modulesText);

            const sanitizedCurrent = stripMemoHtml(settings.currentMemo.replace(/<\/?memo>/gi, '').trim());

            const { chat } = SillyTavern.getContext();
            const N = settings.directPromptContext !== undefined ? settings.directPromptContext : 5;
            let chatLog = '';
            if (N > 0 && chat && chat.length > 0) {
                const recentChat = chat.slice(-N);
                chatLog = `## NARRATIVE HISTORY (Last ${recentChat.length} messages)\n` +
                    recentChat
                        .map(m => {
                            const name = m.is_user ? 'Player' : (m.name || 'Narrator');
                            // Returns null for tool-call messages — excluded from state model context
                            const content = cleanToolCallMessage(m.mes || m['content'] || '');
                            if (content === null) return null;
                            return `${name}: ${content}`;
                        })
                        .filter(line => line !== null)
                        .join('\n\n') + '\n\n';
            }

            const userPrompt =
                worldLoreSection +
                chatLog +
                `## PRIOR MEMO\n${sanitizedCurrent || '(empty — this is the initial setup)'}\n\n` +
                `## USER INSTRUCTION\n${message}\n\n` +
                `## OUTPUT ONLY CHANGED OR NEW SECTIONS:`;

            const result = await sendStateRequest(settings, systemPrompt, userPrompt, signal);

            if (result && typeof result === 'string') {
                let cleanedOutput = result;
                const memoBlocks = [...result.matchAll(/<memo>([\s\S]*?)<\/memo>/gi)];
                if (memoBlocks.length > 0) {
                    cleanedOutput = memoBlocks[memoBlocks.length - 1][1].trim();
                } else {
                    cleanedOutput = result.replace(/<\/?memo>/gi, '').trim();
                }

                let merged = mergeMemo(sanitizedCurrent, cleanedOutput);

                // Modern mode: normalize/create the [XP] block from engine truth,
                // exactly like runStateModelPass — without this, initial character
                // creation (which goes through this direct path) never gets the
                // Level/XP line. No-op for D&D chats.
                merged = applyModernProgression(settings, merged, passChatId);
                merged = applyOriginCanon(settings, merged, passChatId);

                if (merged !== sanitizedCurrent) {
                    const delta = computeDelta(sanitizedCurrent, merged);

                    // Late completion after a chat switch: commit into the
                    // originating chat's saved state, not the live globals
                    // (which now belong to whatever chat the user is viewing).
                    if (settings.chatLinkEnabled && passChatId && passChatId !== activeChatIdNow()) {
                        const passState = settings.chatStates?.[passChatId];
                        if (passState) {
                            commitMemoToChatState(passState, sanitizedCurrent, merged, delta);
                            SillyTavern.getContext().saveSettingsDebounced();
                            toastr['info']('Tracker update finished after you switched chats — the result was saved to its own chat.', 'RPG Tracker');
                        } else {
                            console.warn(`[RPG Tracker] Late direct prompt for unsaved chat "${passChatId}" — result dropped.`);
                        }
                        return;
                    }

                    settings.lastDelta = delta;

                    // Linear Stone History Logic
                    if (settings.historyIndex !== undefined && settings.historyIndex !== -1) {
                        settings.memoHistory = settings.memoHistory.slice(settings.historyIndex);
                    }
                    if (settings.memoHistory[0] !== sanitizedCurrent) {
                        settings.memoHistory.unshift(sanitizedCurrent);
                    }
                    settings.memoHistory.unshift(merged);
                    if (settings.memoHistory.length > 1000) settings.memoHistory.length = 1000;
                    settings.historyIndex = 0;
                    RT.historyViewIndex = -1;

                    const dp = document.getElementById('rpg-tracker-delta-content');
                    if (dp) dp.innerHTML = delta;

                    settings.prevMemo2 = settings.prevMemo1;
                    settings.prevMemo1 = sanitizedCurrent;
                    settings.currentMemo = merged;

                    updateUIMemo(merged);
                    syncMemoView(); // syncMemoView() already calls refreshRenderedView() at its end
                    saveSettings();
                    toastr['success']('Tracker updated.', 'RPG Tracker');
                } else {
                    toastr['info']('No changes were made.', 'RPG Tracker');
                }
            }
        } catch (err) {
            if (err.name === 'AbortError') {
                if (settings.debugMode) console.log("[RPG Tracker] Direct prompt aborted by user.");
                return;
            }
            console.error('[RPG Tracker] Direct prompt failed:', err);
            toastr['error']('Direct prompt failed. Check console.', 'RPG Tracker');
        } finally {
            RT.stateModelRunning = false;
            RT.stateController = null;
            updateStatusIndicator('active');
        }
    }
