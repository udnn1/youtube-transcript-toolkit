// ==UserScript==
// @name         YouTube Transcript Downloader
// @namespace    http://tampermonkey.net/
// @version      3.4
// @description  Download or copy YouTube transcripts, or summarize them with Google Gemini
// @match        https://www.youtube.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_setClipboard
// @grant        GM_registerMenuCommand
// @connect      generativelanguage.googleapis.com
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const DL_BUTTON_ID = 'yt-transcript-dl-btn';
    const COPY_BUTTON_ID = 'yt-transcript-copy-btn';
    const SUM_BUTTON_ID = 'yt-transcript-sum-btn';
    const POPUP_ID = 'yt-transcript-popup';
    const API_KEY_STORE = 'gemini_api_key';
    const MODEL_STORE = 'gemini_model';
    const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta';
    const DEFAULT_MODEL = 'gemini-flash-latest';
    const STATIC_FALLBACK_MODELS = ['gemini-flash-latest', 'gemini-flash-lite-latest'];
    const MAX_MODEL_CANDIDATES = 6;
    const REQUEST_TIMEOUT_MS = 180000;
    const MAX_RETRIES = 3;

    let domObserver = null;
    let checkScheduled = false;
    let requestInFlight = false;
    let runId = 0;
    let modelCache = null;

    function log(...args) {
        console.log('[YT Transcript]', ...args);
    }

    function parseTimestampToSeconds(ts) {
        const parts = ts.trim().split(':').map(Number);
        if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
        if (parts.length === 2) return parts[0] * 60 + parts[1];
        return 0;
    }

    function isWatchPage() {
        return location.pathname === '/watch';
    }

    function getVideoId() {
        return new URL(window.location.href).searchParams.get('v') || 'unknown';
    }

    function getVideoTitle() {
        return document.title.replace(/^\(\d+\)\s*/, '').replace(/ - YouTube$/, '').trim();
    }

    const TRANSCRIPT_VARIANTS = [
        {
            name: 'legacy',
            segmentSelector: 'ytd-transcript-segment-renderer',
            timestampSelector: '.segment-timestamp',
            textSelector: '.segment-text, yt-formatted-string'
        },
        {
            name: 'modern',
            segmentSelector: 'transcript-segment-view-model',
            timestampSelector: '.ytwTranscriptSegmentViewModelTimestamp',
            textSelector: '.ytAttributedStringHost'
        }
    ];

    function detectVariant() {
        return TRANSCRIPT_VARIANTS.find(v => document.querySelector(v.segmentSelector)) || null;
    }

    function collectSegments() {
        const variant = detectVariant();
        if (!variant) return [];
        const parsed = [];
        document.querySelectorAll(variant.segmentSelector).forEach(seg => {
            const tsEl = seg.querySelector(variant.timestampSelector);
            const textEl = seg.querySelector(variant.textSelector);
            if (!tsEl || !textEl) return;
            const timestamp = tsEl.textContent.trim();
            const text = textEl.textContent.replace(/\s+/g, ' ').trim();
            if (text) {
                parsed.push({ timestamp, seconds: parseTimestampToSeconds(timestamp), text });
            }
        });
        return parsed;
    }

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    async function ensureTranscriptSegments() {
        let segs = collectSegments();
        if (segs.length) return segs;

        document.querySelector('#description-inline-expander #expand, tp-yt-paper-button#expand')?.click();
        await sleep(400);

        const btn = document.querySelector('ytd-video-description-transcript-section-renderer button') ||
            [...document.querySelectorAll('button')].find(b => {
                const label = b.getAttribute('aria-label') || b.textContent || '';
                return /transkrypc|transcript/i.test(label) && !/zamknij|close/i.test(label);
            });
        if (!btn) return [];
        btn.click();

        for (let i = 0; i < 40; i++) {
            await sleep(250);
            segs = collectSegments();
            if (segs.length) return segs;
        }
        return [];
    }

    const NO_TRANSCRIPT_MSG = 'Nie udało się pobrać transkrypcji.\nTen film może nie mieć napisów — spróbuj otworzyć panel „Transkrypcja” ręcznie pod opisem filmu.';

    function buildData(parsedSegments) {
        const videoId = getVideoId();
        return {
            title: getVideoTitle(),
            url: `https://www.youtube.com/watch?v=${videoId}`,
            videoId,
            exportedAt: new Date().toISOString(),
            segments: parsedSegments,
            fullText: parsedSegments.map(s => s.text).join(' ')
        };
    }

    async function downloadTranscript() {
        const parsed = await ensureTranscriptSegments();
        if (!parsed.length) {
            alert(NO_TRANSCRIPT_MSG);
            return;
        }
        const data = buildData(parsed);
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = `transcript_${data.videoId}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    }

    function formatTranscriptText(data) {
        return [
            data.title,
            data.url,
            '',
            ...data.segments.map(s => `[${s.timestamp}] ${s.text}`)
        ].join('\n');
    }

    async function writeClipboard(text) {
        if (typeof GM_setClipboard === 'function') {
            try {
                GM_setClipboard(text, 'text');
                return true;
            } catch (e) {
                log('GM_setClipboard nie zadziałał', e);
            }
        }
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (e) {
            log('navigator.clipboard nie zadziałał', e);
        }
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
        document.body.appendChild(ta);
        ta.select();
        let ok = false;
        try { ok = document.execCommand('copy'); } catch (e) { }
        ta.remove();
        return ok;
    }

    function setButtonLabel(btn, label, restoreAfterMs) {
        if (!btn) return;
        clearTimeout(btn._restoreTimer);
        btn.textContent = label;
        if (restoreAfterMs) {
            btn._restoreTimer = setTimeout(() => { btn.textContent = btn.dataset.label; }, restoreAfterMs);
        }
    }

    async function copyTranscript() {
        const btn = document.getElementById(COPY_BUTTON_ID);
        setButtonLabel(btn, '⏳ Pobieram…');
        const parsed = await ensureTranscriptSegments();
        if (!parsed.length) {
            setButtonLabel(btn, btn?.dataset.label);
            alert(NO_TRANSCRIPT_MSG);
            return;
        }
        const ok = await writeClipboard(formatTranscriptText(buildData(parsed)));
        setButtonLabel(btn, ok ? `✅ Skopiowano (${parsed.length} linii)` : '❌ Nie udało się skopiować', 2500);
    }

    function sanitizeKey(raw) {
        return (raw || '')
            .trim()
            .replace(/^["'`]+|["'`]+$/g, '')
            .replace(/^Bearer\s+/i, '')
            .replace(/\s+/g, '');
    }

    function getApiKey() {
        let key = sanitizeKey(GM_getValue(API_KEY_STORE, ''));
        if (!key) {
            key = sanitizeKey(window.prompt('Wklej swój klucz API Gemini (https://aistudio.google.com/apikey):'));
            if (key) GM_setValue(API_KEY_STORE, key);
        }
        return key;
    }

    function getUserModel() {
        return (GM_getValue(MODEL_STORE, '') || '').trim().replace(/^models\//, '');
    }

    function gmRequest(details) {
        return new Promise(resolve => {
            GM_xmlhttpRequest({
                ...details,
                timeout: REQUEST_TIMEOUT_MS,
                onload: (res) => resolve(res),
                ontimeout: () => resolve({ status: -1, kind: 'timeout', responseText: '' }),
                onabort: () => resolve({ status: -1, kind: 'abort', responseText: '' }),
                onerror: (err) => resolve({
                    status: 0,
                    kind: 'error',
                    responseText: '',
                    errorText: err?.error || err?.statusText || ''
                })
            });
        });
    }

    function parseError(res) {
        try {
            const err = JSON.parse(res.responseText).error || {};
            const details = err.details || [];
            const reason = details.find(d => d.reason)?.reason || '';
            const retryDelay = details.find(d => d.retryDelay)?.retryDelay || '';
            return {
                message: err.message || res.responseText.slice(0, 300),
                status: err.status || '',
                reason,
                retrySecs: parseFloat(retryDelay) || 0,
                raw: res.responseText || ''
            };
        } catch (e) {
            const txt = (res.responseText || '').slice(0, 300);
            return { message: txt, status: '', reason: '', retrySecs: 0, raw: txt };
        }
    }

    function describeAccessError(res, err) {
        if (res.status === 0) {
            return '❌ Połączenie z generativelanguage.googleapis.com zostało zablokowane.\n\n' +
                (res.errorText ? `Szczegóły: \`${res.errorText}\`\n\n` : '') +
                '- Tampermonkey → ten skrypt → Ustawienia → sprawdź, czy domena nie jest na liście zablokowanych (i zezwól na nią, jeśli Tampermonkey pytał)\n' +
                '- Wyłącz na chwilę adblock / VPN / firewall i spróbuj ponownie';
        }
        if (res.status === -1) {
            return res.kind === 'timeout'
                ? `❌ Gemini nie odpowiedział w ciągu ${REQUEST_TIMEOUT_MS / 1000} s. Spróbuj ponownie.`
                : '❌ Zapytanie do Gemini API zostało przerwane.';
        }
        if (res.status === 401 || /API_KEY_INVALID|API key not valid|API key expired/i.test(err.reason + ' ' + err.message)) {
            GM_setValue(API_KEY_STORE, '');
            modelCache = null;
            return `❌ Gemini odrzucił klucz API: ${err.message}\n\n` +
                '- Skopiuj klucz ponownie z aistudio.google.com/apikey\n' +
                '- Zapisany klucz został usunięty — przy następnym kliknięciu skrypt poprosi o nowy';
        }
        if (res.status === 403) {
            return `❌ Brak dostępu (403): ${err.message}\n\n` +
                '- W Google Cloud projektu klucza musi być włączone **Generative Language API**\n' +
                '- Sprawdź restrykcje klucza (HTTP referrer / IP / dozwolone API) — klucz z restrykcją „HTTP referrer” nie zadziała z Tampermonkey\n' +
                '- Gemini API może być niedostępne dla konta w Twoim regionie';
        }
        if (res.status === 400 && /FAILED_PRECONDITION|location is not supported|User location/i.test(err.status + ' ' + err.message)) {
            return `❌ Gemini API odrzuciło zapytanie: ${err.message}\n\n` +
                '- Darmowy poziom Gemini API bywa niedostępny w części krajów — może być potrzebne włączenie płatności w projekcie Google Cloud';
        }
        return null;
    }

    async function listModels(apiKey) {
        if (modelCache?.key === apiKey) return { list: modelCache.list };
        const res = await gmRequest({
            method: 'GET',
            url: `${GEMINI_API}/models?pageSize=1000`,
            headers: { 'x-goog-api-key': apiKey }
        });
        log('Lista modeli: HTTP', res.status);
        if (res.status < 200 || res.status >= 300) return { res };
        try {
            const list = (JSON.parse(res.responseText).models || [])
                .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
                .map(m => m.name.replace(/^models\//, ''));
            modelCache = { key: apiKey, list };
            return { list };
        } catch (e) {
            log('Nie udało się sparsować listy modeli', e);
            return { list: null };
        }
    }

    function rankTextModels(list) {
        const version = (n) => parseFloat((n.match(/^gemini-(\d+(?:\.\d+)?)/) || [])[1]) || 0;
        const sorted = list
            .filter(n => /^gemini-/.test(n) && /flash/.test(n))
            .filter(n => !/image|tts|audio|live|embed|robotics|computer-use|native|-exp/.test(n))
            .sort((a, b) => {
                const pa = /preview/.test(a), pb = /preview/.test(b);
                if (pa !== pb) return pa ? 1 : -1;
                const xa = /-latest$/.test(a), xb = /-latest$/.test(b);
                if (xa !== xb) return xa ? -1 : 1;
                return version(b) - version(a) || a.length - b.length;
            });
        const full = sorted.filter(n => !/lite/.test(n));
        const lite = sorted.filter(n => /lite/.test(n));
        const mixed = [];
        for (let i = 0; i < Math.max(full.length, lite.length); i++) {
            if (full[i]) mixed.push(full[i]);
            if (lite[i]) mixed.push(lite[i]);
        }
        return mixed;
    }

    async function resolveModelCandidates(apiKey) {
        const userModel = getUserModel();
        const { list, res } = await listModels(apiKey);

        if (res) {
            const accessErr = describeAccessError(res, parseError(res));
            if (accessErr) return { fatal: accessErr };
        }

        let candidates;
        if (list && list.length) {
            candidates = [];
            if (userModel) {
                if (list.includes(userModel)) candidates.push(userModel);
                else log(`Model ustawiony ręcznie („${userModel}”) nie jest dostępny dla tego klucza — pomijam`);
            }
            candidates.push(...rankTextModels(list));
        } else {
            candidates = [userModel, ...STATIC_FALLBACK_MODELS].filter(Boolean);
        }

        candidates = [...new Set(candidates)].slice(0, MAX_MODEL_CANDIDATES);
        log('Kandydaci modeli:', candidates);
        if (!candidates.length) {
            return { fatal: '❌ Twój klucz API nie ma dostępu do żadnego modelu Gemini Flash.\n\nUstaw model ręcznie w menu Tampermonkey („Zmień model Gemini”).' };
        }
        return { candidates };
    }

    async function countdown(seconds, textFn, myRun) {
        for (let left = Math.ceil(seconds); left > 0; left--) {
            if (myRun !== runId || !document.getElementById(POPUP_ID)) return false;
            showPopup(textFn(left), true);
            await sleep(1000);
        }
        return myRun === runId && !!document.getElementById(POPUP_ID);
    }

    function extractSummary(res) {
        const json = JSON.parse(res.responseText);
        if (json.promptFeedback?.blockReason) {
            return `❌ Gemini zablokował zapytanie (${json.promptFeedback.blockReason}).`;
        }
        const cand = json.candidates?.[0];
        const summary = (cand?.content?.parts || [])
            .filter(p => p.text && !p.thought)
            .map(p => p.text)
            .join('')
            .trim();
        if (!summary) {
            return `❌ Pusta odpowiedź od API${cand?.finishReason ? ` (finishReason: ${cand.finishReason})` : ''}.`;
        }
        const note = cand.finishReason === 'MAX_TOKENS' ? '\n\n*(odpowiedź ucięta — limit długości)*' : '';
        return summary + note;
    }

    async function runSummary(myRun) {
        const parsed = await ensureTranscriptSegments();
        if (myRun !== runId) return;
        if (!parsed.length) {
            alert(NO_TRANSCRIPT_MSG);
            return;
        }

        const apiKey = getApiKey();
        if (!apiKey) return;

        const data = buildData(parsed);
        const approxTokens = Math.round(data.fullText.length / 4);
        const userPrompt = [
            'Streść poniższy transkrypt filmu z YouTube w formie listy najważniejszych punktów kluczowych.',
            'Pisz po polsku. Używaj zwięzłych bulletów (zaczynaj od "- "). Pomiń wtręty, dygresje i powtórzenia.',
            '',
            `Tytuł filmu: ${data.title}`,
            '',
            'TRANSKRYPT:',
            data.fullText
        ].join('\n');

        showPopup('⏳ Sprawdzam dostępne modele Gemini...', true);
        const resolved = await resolveModelCandidates(apiKey);
        if (myRun !== runId) return;
        if (resolved.fatal) {
            showPopup(resolved.fatal, false);
            return;
        }

        const queue = [...resolved.candidates];
        const tried = [];
        let lastErr = null;

        for (let round = 0; round <= MAX_RETRIES && queue.length; round++) {
            let maxRetrySecs = 0;
            let allPerDay = true;

            for (let i = 0; i < queue.length; i++) {
                const model = queue[i];
                showPopup(`⏳ Generuję streszczenie (${model}, ~${approxTokens} tokenów)...` +
                    (round ? `\n\nRunda ${round + 1}/${MAX_RETRIES + 1}` : ''), true);

                const res = await gmRequest({
                    method: 'POST',
                    url: `${GEMINI_API}/models/${encodeURIComponent(model)}:generateContent`,
                    headers: {
                        'Content-Type': 'application/json',
                        'x-goog-api-key': apiKey
                    },
                    data: JSON.stringify({
                        contents: [{ role: 'user', parts: [{ text: userPrompt }] }]
                    })
                });
                if (myRun !== runId) return;
                log('Odpowiedź HTTP', model, res.status, (res.responseText || '').slice(0, 300));

                if (res.status >= 200 && res.status < 300) {
                    try {
                        showPopup(extractSummary(res), false);
                    } catch (e) {
                        log('Błąd parsowania', e);
                        showPopup('❌ Nie udało się sparsować odpowiedzi API.', false);
                    }
                    return;
                }

                const err = parseError(res);
                lastErr = { model, status: res.status, err };
                const accessErr = describeAccessError(res, err);
                if (accessErr) {
                    showPopup(accessErr, false);
                    return;
                }

                if (res.status === 404 ||
                    (res.status === 400 && /not found|not supported|unsupported|deprecated|no longer available/i.test(err.message))) {
                    log(`Model ${model} niedostępny (${res.status}) — usuwam z kolejki`);
                    tried.push(`${model} (${res.status})`);
                    queue.splice(i, 1);
                    i--;
                    continue;
                }

                if (res.status === 429 || res.status === 500 || res.status === 503) {
                    const label = res.status === 429 ? 'Limit Gemini wyczerpany' : 'Gemini przeciążony';
                    tried.push(`${model} (${res.status})`);
                    maxRetrySecs = Math.max(maxRetrySecs, err.retrySecs);
                    if (!/per.?day|PerDay/i.test(err.raw)) allPerDay = false;
                    const next = queue[i + 1];
                    if (next) {
                        const ok = await countdown(2, (left) =>
                            `⏳ ${label} na ${model} („${err.message.slice(0, 160)}”).\n\nPrzełączam na ${next} za ${left}s...`, myRun);
                        if (!ok) return;
                    }
                    continue;
                }

                showPopup(`❌ Błąd API (HTTP ${res.status}${err.status ? ' ' + err.status : ''}, model ${model}):\n${err.message}`, false);
                return;
            }

            if (!queue.length || allPerDay || round >= MAX_RETRIES) break;
            const wait = Math.min(maxRetrySecs || 15 * (round + 1), 90);
            const ok = await countdown(wait, (left) =>
                `⏳ Wszystkie modele są teraz przeciążone lub bez limitu (${queue.join(', ')}).\n\n` +
                `Ponawiam za ${left}s... (runda ${round + 2}/${MAX_RETRIES + 1})`, myRun);
            if (!ok) return;
        }

        const lastStatus = lastErr?.status;
        if (queue.length && (lastStatus === 429 || lastStatus === 500 || lastStatus === 503)) {
            showPopup(`❌ ${lastStatus === 429 ? 'Wyczerpany limit Gemini' : 'Gemini jest przeciążony'} na wszystkich dostępnych modelach.\n\n` +
                `Odpowiedź API: \`${lastErr.err.message}\`\n\n` +
                `- Próbowane: ${[...new Set(tried)].join(', ')}\n` +
                `- Transkrypt to ok. **${approxTokens} tokenów**\n` +
                '- Przeciążenie (503) zwykle mija po kilku minutach — spróbuj ponownie później\n' +
                '- Jeśli komunikat mówi o limicie **dziennym** (per day), trzeba poczekać do resetu (północ czasu pacyficznego, ok. 9:00 w Polsce)\n' +
                '- Swoje limity sprawdzisz na aistudio.google.com → Usage / Rate limits', false);
            return;
        }
        showPopup('❌ Żaden z modeli Gemini nie jest dostępny dla tego klucza.\n\n' +
            `- Próbowane: ${[...new Set(tried)].join(', ') || resolved.candidates.join(', ')}\n` +
            (lastErr ? `- Ostatni błąd: \`${lastErr.err.message}\`\n` : '') +
            '- Ustaw model ręcznie w menu Tampermonkey („Zmień model Gemini”) — skrypt pokaże tam listę dostępnych modeli', false);
    }

    async function summarizeTranscript() {
        if (requestInFlight) {
            log('Zapytanie już trwa — pomijam kolejne kliknięcie.');
            if (!document.getElementById(POPUP_ID)) showPopup('⏳ Streszczenie jest w trakcie generowania...', true);
            return;
        }
        requestInFlight = true;
        const myRun = ++runId;
        try {
            await runSummary(myRun);
        } catch (e) {
            log('Nieoczekiwany błąd', e);
            if (myRun === runId) showPopup(`❌ Nieoczekiwany błąd: ${e?.message || e}`, false);
        } finally {
            if (myRun === runId) requestInFlight = false;
        }
    }

    function closePopup() {
        document.getElementById(POPUP_ID)?.remove();
        document.removeEventListener('keydown', onEscClose);
    }

    function onEscClose(e) {
        if (e.key === 'Escape') closePopup();
    }

    function appendInline(parent, text) {
        const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
        let last = 0, m;
        while ((m = re.exec(text)) !== null) {
            if (m.index > last) parent.appendChild(document.createTextNode(text.slice(last, m.index)));
            const tok = m[0];
            let el;
            if (tok.startsWith('**')) {
                el = document.createElement('strong');
                el.textContent = tok.slice(2, -2);
            } else if (tok.startsWith('`')) {
                el = document.createElement('code');
                el.textContent = tok.slice(1, -1);
                el.style.cssText = 'background:#3a3a3a;padding:1px 5px;border-radius:4px;font-size:.92em';
            } else {
                el = document.createElement('em');
                el.textContent = tok.slice(1, -1);
            }
            parent.appendChild(el);
            last = m.index + tok.length;
        }
        if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
    }

    function renderMarkdown(md) {
        const frag = document.createDocumentFragment();
        const lines = md.replace(/\r/g, '').split('\n');
        const listStack = [];

        const closeLists = (toDepth) => {
            while (listStack.length > toDepth) listStack.pop();
        };
        const currentParent = () =>
            listStack.length ? listStack[listStack.length - 1].ul : frag;

        for (const raw of lines) {
            const line = raw.replace(/\s+$/, '');
            if (!line.trim()) { closeLists(0); continue; }

            const heading = line.match(/^(#{1,6})\s+(.*)$/);
            if (heading) {
                closeLists(0);
                const lvl = Math.min(heading[1].length + 1, 4);
                const size = { 2: '17px', 3: '15.5px', 4: '14.5px' }[lvl] || '14px';
                const h = document.createElement('h' + lvl);
                h.style.cssText = `margin:16px 0 8px;font-size:${size};font-weight:700;color:#fff`;
                appendInline(h, heading[2]);
                frag.appendChild(h);
                continue;
            }

            const bullet = line.match(/^(\s*)[-*](?:\s+|(?=[-*]\s))(.*)$/);
            if (bullet) {
                const depth = Math.floor(bullet[1].length / 2) + 1;
                while (listStack.length < depth) {
                    const ul = document.createElement('ul');
                    ul.style.cssText = 'margin:4px 0;padding-left:22px';
                    currentParent().appendChild(ul);
                    listStack.push({ ul });
                }
                closeLists(depth);
                const li = document.createElement('li');
                li.style.cssText = 'margin:3px 0';
                const liText = bullet[2].replace(/^(?:[-*•]\s+)+/, '');
                appendInline(li, liText);
                listStack[listStack.length - 1].ul.appendChild(li);
                continue;
            }

            closeLists(0);
            const p = document.createElement('p');
            p.style.cssText = 'margin:8px 0';
            appendInline(p, line);
            frag.appendChild(p);
        }
        return frag;
    }

    function showPopup(content, loading) {
        closePopup();

        const overlay = document.createElement('div');
        overlay.id = POPUP_ID;
        overlay.style.cssText = [
            'position: fixed', 'inset: 0',
            'background: rgba(0,0,0,.6)',
            'display: flex', 'align-items: center', 'justify-content: center',
            'z-index: 2147483647',
            'font-family: Roboto, Arial, sans-serif'
        ].join(';');

        const box = document.createElement('div');
        box.style.cssText = [
            'background: #212121', 'color: #f1f1f1',
            'max-width: 640px', 'width: 90%', 'max-height: 80vh',
            'border-radius: 12px', 'padding: 24px 28px',
            'box-shadow: 0 12px 40px rgba(0,0,0,.5)',
            'overflow-y: auto', 'position: relative'
        ].join(';');

        const title = document.createElement('h2');
        title.textContent = '📝 Streszczenie filmu';
        title.style.cssText = 'margin: 0 0 16px; font-size: 18px; font-weight: 600;';

        const closeBtn = document.createElement('button');
        closeBtn.textContent = '✕';
        closeBtn.style.cssText = [
            'position: absolute', 'top: 16px', 'right: 18px',
            'background: none', 'border: none', 'color: #aaa',
            'font-size: 20px', 'cursor: pointer', 'line-height: 1'
        ].join(';');
        closeBtn.addEventListener('click', closePopup);

        const body = document.createElement('div');
        body.style.cssText = [
            'line-height: 1.6', 'white-space: normal',
            'font-size: 14.5px', loading ? 'opacity: .7' : ''
        ].join(';');
        if (loading) {
            body.style.whiteSpace = 'pre-line';
            body.textContent = content;
        } else {
            body.appendChild(renderMarkdown(content));
        }

        box.appendChild(closeBtn);
        box.appendChild(title);
        box.appendChild(body);
        overlay.appendChild(box);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) closePopup(); });
        document.addEventListener('keydown', onEscClose);
        document.body.appendChild(overlay);
    }

    function makeButton(id, label, bottom, bg, bgHover, onClick) {
        const btn = document.createElement('button');
        btn.id = id;
        btn.textContent = label;
        btn.dataset.label = label;
        btn.style.cssText = [
            'position: fixed',
            `bottom: ${bottom}px`,
            'right: 24px',
            'padding: 12px 18px',
            `background: ${bg}`,
            'color: #fff',
            'border: none',
            'border-radius: 24px',
            'font-size: 14px',
            'font-weight: 600',
            'font-family: Roboto, Arial, sans-serif',
            'cursor: pointer',
            'letter-spacing: .01em',
            'box-shadow: 0 4px 12px rgba(0,0,0,.35)',
            'transition: background .15s, transform .1s',
            'z-index: 2147483646',
        ].join(';');
        btn.addEventListener('mouseenter', () => { btn.style.background = bgHover; });
        btn.addEventListener('mouseleave', () => { btn.style.background = bg; });
        btn.addEventListener('mousedown', () => { btn.style.transform = 'scale(.96)'; });
        btn.addEventListener('mouseup', () => { btn.style.transform = 'scale(1)'; });
        btn.addEventListener('click', onClick);
        return btn;
    }

    function injectButtons() {
        if (!document.getElementById(DL_BUTTON_ID)) {
            document.body.appendChild(
                makeButton(DL_BUTTON_ID, '⬇ Pobierz JSON', 24, '#ff0000', '#c00', downloadTranscript)
            );
        }
        if (!document.getElementById(COPY_BUTTON_ID)) {
            document.body.appendChild(
                makeButton(COPY_BUTTON_ID, '📋 Kopiuj transkrypt', 76, '#3f3f3f', '#565656', copyTranscript)
            );
        }
        if (!document.getElementById(SUM_BUTTON_ID)) {
            document.body.appendChild(
                makeButton(SUM_BUTTON_ID, '✨ Streść (Gemini)', 128, '#1a73e8', '#1558b0', summarizeTranscript)
            );
        }
    }

    function removeButtons() {
        document.getElementById(DL_BUTTON_ID)?.remove();
        document.getElementById(COPY_BUTTON_ID)?.remove();
        document.getElementById(SUM_BUTTON_ID)?.remove();
    }

    function checkAndInject() {
        checkScheduled = false;
        if (isWatchPage()) {
            injectButtons();
        } else {
            removeButtons();
        }
    }

    function scheduleCheck() {
        if (checkScheduled) return;
        checkScheduled = true;
        requestAnimationFrame(checkAndInject);
    }

    function startObserver() {
        domObserver?.disconnect();
        domObserver = new MutationObserver(scheduleCheck);
        domObserver.observe(document.body, { childList: true, subtree: true });
        scheduleCheck();
    }

    if (typeof GM_registerMenuCommand === 'function') {
        GM_registerMenuCommand('Resetuj klucz API Gemini', () => {
            GM_setValue(API_KEY_STORE, '');
            modelCache = null;
            alert('Klucz API Gemini został usunięty. Przy następnym streszczeniu skrypt poprosi o nowy.');
        });
        GM_registerMenuCommand('Zmień model Gemini', async () => {
            let hint = '';
            const key = sanitizeKey(GM_getValue(API_KEY_STORE, ''));
            if (key) {
                const { list } = await listModels(key);
                const gem = (list || []).filter(n => /^gemini-/.test(n)).slice(0, 25);
                if (gem.length) hint = `\n\nDostępne dla Twojego klucza:\n${gem.join('\n')}`;
            }
            const m = window.prompt(`Nazwa modelu Gemini (puste = automatyczny wybór, zaczynając od ${DEFAULT_MODEL}):${hint}`, getUserModel());
            if (m === null) return;
            GM_setValue(MODEL_STORE, m.trim().replace(/^models\//, ''));
            alert(`Model ustawiony na: ${getUserModel() || 'automatyczny wybór'}`);
        });
    }

    document.addEventListener('yt-navigate-finish', () => {
        removeButtons();
        closePopup();
        runId++;
        requestInFlight = false;
        startObserver();
    });

    startObserver();
})();
