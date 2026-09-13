// ==UserScript==
// @name         YouTube Transcript Downloader
// @namespace    http://tampermonkey.net/
// @version      3.1
// @description  Download YouTube transcripts as JSON, or summarize them with Google Gemini
// @match        https://www.youtube.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @connect      generativelanguage.googleapis.com
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const DL_BUTTON_ID = 'yt-transcript-dl-btn';
    const SUM_BUTTON_ID = 'yt-transcript-sum-btn';
    const POPUP_ID = 'yt-transcript-popup';
    const API_KEY_STORE = 'gemini_api_key';
    const MODEL_STORE = 'gemini_model';
    const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';
    const DEFAULT_MODEL = 'gemini-flash-latest';
    const FALLBACK_MODEL = 'gemini-2.5-flash';
    const REQUEST_TIMEOUT_MS = 180000;
    const MAX_RETRIES = 3;

    let domObserver = null;
    let checkScheduled = false;
    let requestInFlight = false;

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

    function getModel() {
        return (GM_getValue(MODEL_STORE, '') || DEFAULT_MODEL).trim();
    }

    async function summarizeTranscript() {
        if (requestInFlight) {
            log('Zapytanie już trwa — pomijam kolejne kliknięcie.');
            return;
        }

        requestInFlight = true;
        const parsed = await ensureTranscriptSegments();
        requestInFlight = false;
        if (!parsed.length) {
            alert(NO_TRANSCRIPT_MSG);
            return;
        }

        const apiKey = getApiKey();
        if (!apiKey) return;

        let model = getModel();
        const data = buildData(parsed);
        const approxTokens = Math.round(data.fullText.length / 4);
        requestInFlight = true;
        showPopup(`⏳ Generuję streszczenie (${model}, ~${approxTokens} tokenów)...`, true);

        const userPrompt = [
            'Streść poniższy transkrypt filmu z YouTube w formie listy najważniejszych punktów kluczowych.',
            'Pisz po polsku. Używaj zwięzłych bulletów (zaczynaj od "- "). Pomiń wtręty, dygresje i powtórzenia.',
            '',
            `Tytuł filmu: ${data.title}`,
            '',
            'TRANSKRYPT:',
            data.fullText
        ].join('\n');

        function finish(content) {
            requestInFlight = false;
            showPopup(content, false);
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
                    retrySecs: parseFloat(retryDelay) || 0
                };
            } catch (e) {
                return { message: (res.responseText || '').slice(0, 300), status: '', reason: '', retrySecs: 0 };
            }
        }

        function countdownThenRetry(seconds, attempt, reason) {
            let left = Math.ceil(seconds);
            const tick = () => {
                if (!document.getElementById(POPUP_ID)) {
                    requestInFlight = false;
                    return;
                }
                showPopup(`⏳ ${reason}\n\nPonawiam za ${left}s... (próba ${attempt + 1}/${MAX_RETRIES}, model ${model})`, true);
                if (left <= 0) { sendRequest(attempt + 1); return; }
                left--;
                setTimeout(tick, 1000);
            };
            tick();
        }

        function handleResponse(res, attempt) {
            log('Odpowiedź HTTP', res.status, (res.responseText || '').slice(0, 300));

            if (res.status === 0) {
                finish('❌ Połączenie z generativelanguage.googleapis.com zostało zablokowane (HTTP 0).\n\n' +
                    '- Tampermonkey → ten skrypt → Ustawienia → sprawdź, czy domena nie jest na liście zablokowanych\n' +
                    '- Wyłącz na chwilę adblock / VPN / firewall i spróbuj ponownie');
                return;
            }

            if (res.status < 200 || res.status >= 300) {
                const err = parseError(res);

                if (/API_KEY_INVALID|API key not valid|API_KEY/i.test(err.reason + err.message) || res.status === 401) {
                    GM_setValue(API_KEY_STORE, '');
                    finish(`❌ Gemini odrzucił klucz API: ${err.message}\n\n` +
                        '- Skopiuj klucz ponownie z aistudio.google.com/apikey\n' +
                        '- Zapisany klucz został usunięty — przy następnym kliknięciu skrypt poprosi o nowy');
                    return;
                }
                if (res.status === 403) {
                    finish(`❌ Brak dostępu (403): ${err.message}\n\n` +
                        '- W Google Cloud projektu klucza musi być włączone **Generative Language API**\n' +
                        '- Gemini API może być niedostępne dla konta w Twoim regionie lub z ograniczeniami klucza (restrykcje HTTP referrer / IP)');
                    return;
                }
                if (res.status === 404) {
                    finish(`❌ Nie znaleziono modelu \`${model}\` (404): ${err.message}\n\nZmień model w menu Tampermonkey („Zmień model Gemini”).`);
                    return;
                }
                if (res.status === 429 || res.status === 503) {
                    const overloaded = res.status === 503;
                    if (model !== FALLBACK_MODEL) {
                        log(`${res.status} na ${model} — przełączam na ${FALLBACK_MODEL}`);
                        model = FALLBACK_MODEL;
                        countdownThenRetry(2, attempt, `${overloaded ? 'Model przeciążony' : 'Limit modelu wyczerpany'} („${err.message.slice(0, 160)}”).\nPrzełączam na ${FALLBACK_MODEL}.`);
                        return;
                    }
                    if (attempt >= MAX_RETRIES) {
                        finish(`❌ ${overloaded ? 'Gemini jest przeciążony' : 'Wyczerpany limit Gemini'} mimo ponawiania.\n\nOdpowiedź API: \`${err.message}\`\n\n` +
                            `- Transkrypt to ok. **${approxTokens} tokenów**\n` +
                            '- Jeśli komunikat mówi o limicie **dziennym** (per day), trzeba poczekać do resetu (północ czasu pacyficznego, ok. 9:00 w Polsce)\n' +
                            '- Swoje limity sprawdzisz na aistudio.google.com → Usage / Rate limits');
                        return;
                    }
                    const wait = err.retrySecs || (overloaded ? 15 * (attempt + 1) : 60);
                    countdownThenRetry(wait, attempt, `${overloaded ? 'Gemini przeciążony' : 'Limit Gemini'} („${err.message.slice(0, 160)}”).`);
                    return;
                }
                finish(`❌ Błąd API (HTTP ${res.status}${err.status ? ' ' + err.status : ''}):\n${err.message}`);
                return;
            }

            try {
                const json = JSON.parse(res.responseText);
                if (json.promptFeedback?.blockReason) {
                    finish(`❌ Gemini zablokował zapytanie (${json.promptFeedback.blockReason}).`);
                    return;
                }
                const cand = json.candidates?.[0];
                const summary = (cand?.content?.parts || [])
                    .filter(p => p.text && !p.thought)
                    .map(p => p.text)
                    .join('')
                    .trim();
                if (summary) {
                    const note = cand.finishReason === 'MAX_TOKENS' ? '\n\n*(odpowiedź ucięta — limit długości)*' : '';
                    finish(summary + note);
                } else {
                    finish(`❌ Pusta odpowiedź od API${cand?.finishReason ? ` (finishReason: ${cand.finishReason})` : ''}.`);
                }
            } catch (e) {
                log('Błąd parsowania', e);
                finish('❌ Nie udało się sparsować odpowiedzi API.');
            }
        }

        function sendRequest(attempt) {
            GM_xmlhttpRequest({
                method: 'POST',
                url: `${GEMINI_BASE}${encodeURIComponent(model)}:generateContent`,
                headers: {
                    'Content-Type': 'application/json',
                    'x-goog-api-key': apiKey
                },
                data: JSON.stringify({
                    contents: [{ role: 'user', parts: [{ text: userPrompt }] }]
                }),
                timeout: REQUEST_TIMEOUT_MS,
                onload: (res) => handleResponse(res, attempt),
                ontimeout: () => finish(`❌ Gemini nie odpowiedział w ciągu ${REQUEST_TIMEOUT_MS / 1000} s. Spróbuj ponownie.`),
                onabort: () => finish('❌ Zapytanie do Gemini API zostało przerwane.'),
                onerror: (err) => {
                    log('Błąd sieci', err);
                    finish(`❌ Błąd sieci podczas połączenia z Gemini API.\n${err?.error || err?.statusText || ''}\n\n` +
                        'Sprawdź, czy Tampermonkey nie blokuje domeny generativelanguage.googleapis.com i czy adblock/VPN nie przerywa połączenia.');
                }
            });
        }

        sendRequest(0);
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
        if (!document.getElementById(SUM_BUTTON_ID)) {
            document.body.appendChild(
                makeButton(SUM_BUTTON_ID, '✨ Streść (Gemini)', 76, '#1a73e8', '#1558b0', summarizeTranscript)
            );
        }
    }

    function removeButtons() {
        document.getElementById(DL_BUTTON_ID)?.remove();
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
            alert('Klucz API Gemini został usunięty. Przy następnym streszczeniu skrypt poprosi o nowy.');
        });
        GM_registerMenuCommand('Zmień model Gemini', () => {
            const m = window.prompt(`Nazwa modelu Gemini (puste = ${DEFAULT_MODEL}):`, getModel());
            if (m === null) return;
            GM_setValue(MODEL_STORE, m.trim());
            alert(`Model ustawiony na: ${getModel()}`);
        });
    }

    document.addEventListener('yt-navigate-finish', () => {
        removeButtons();
        closePopup();
        requestInFlight = false;
        startObserver();
    });

    startObserver();
})();
