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
import { buildLorebookContext, buildModulesInstructionText, cleanToolCallMessage, computeDelta, mergeMemo, parseQuestsFromMemo, parseXpFromMemo, syncQuestsFromMemo, writeQuestsToMemo, writeXpLineToMemo } from './memo-processor.js';
import { detectLevelUp, formatXpLine, levelForXp } from './progression-engine.js';
import { ensureTierPregenerated } from './skill-forge.js';
import { stripMemoHtml } from './renderer.js';
import { checkQuestDeadlines } from './quests.js';
import { RT } from './shared-state.js';
import { saveSettings, syncMemoView, updateUIMemo, updateStatusIndicator, refreshRenderedView } from './index.js';

    export async function runStateModelPass(narrativeOutput, isFullContext = false, overrideLookback = null) {
        const settings = getSettings();
        // Captured NOW: the user may switch chats while the LLM generates, and
        // progression must apply to the chat this pass belongs to.
        const passChatId = (typeof globalThis._rpgCurrentChatId === 'function'
            ? globalThis._rpgCurrentChatId()
            : SillyTavern.getContext().chatId) || null;

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

            let priorMemoText = `## TRACKER STATE 0 (Current)\n${stripMemoHtml(settings.currentMemo)}\n\n`;
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

            const result = await sendStateRequest(settings, systemPrompt, userPrompt);
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

                // Also sanitize the current stored memo in case it was previously
                // contaminated by a prior session that saved raw tags.
                const sanitizedCurrent = settings.currentMemo.replace(/<\/?memo>/gi, '').trim();

                let merged = mergeMemo(sanitizedCurrent, cleanedOutput);

                if (settings.debugMode) {
                    console.log(`[RPG Tracker] Memo ${merged !== sanitizedCurrent ? 'updated (partial merge)' : 'unchanged'}.`);
                }

                // Push snapshot to rolling history
                const delta = computeDelta(sanitizedCurrent, merged);

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

                // Linear Stone History Logic:
                // 1. If we were viewing/committed to a past state, delete the "abandoned" future.
                if (settings.historyIndex !== undefined && settings.historyIndex !== -1) {
                    if (settings.debugMode) console.log(`[RPG Tracker] Splicing history at index ${settings.historyIndex} due to new update.`);
                    settings.memoHistory = settings.memoHistory.slice(settings.historyIndex);
                }

                // 2. Archive the state BEFORE this generation to history
                if (settings.memoHistory[0] !== sanitizedCurrent) {
                    settings.memoHistory.unshift(sanitizedCurrent);
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
                settings.prevMemo1 = sanitizedCurrent;
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

            const result = await sendStateRequest(settings, systemPrompt, userPrompt);

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

                if (merged !== sanitizedCurrent) {
                    const delta = computeDelta(sanitizedCurrent, merged);
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
