// ==UserScript==
// @name         YouTube Transcript Downloader
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  Download YouTube transcripts as JSON, or summarize them with Mistral AI
// @match        https://www.youtube.com/watch*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @connect      api.mistral.ai
// ==/UserScript==

(function () {
    'use strict';

    const DL_BUTTON_ID = 'yt-transcript-dl-btn';
    const SUM_BUTTON_ID = 'yt-transcript-sum-btn';
    const POPUP_ID = 'yt-transcript-popup';
    const API_KEY_STORE = 'mistral_api_key';
    const MISTRAL_ENDPOINT = 'https://api.mistral.ai/v1/chat/completions';
    const MISTRAL_MODEL = 'mistral-medium-latest';

    let domObserver = null;

    function parseTimestampToSeconds(ts) {
        const parts = ts.trim().split(':').map(Number);
        if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
        if (parts.length === 2) return parts[0] * 60 + parts[1];
        return 0;
    }

    function getVideoId() {
        return new URL(window.location.href).searchParams.get('v') || 'unknown';
    }

    function getVideoTitle() {
        return document.title.replace(/ - YouTube$/, '').trim();
    }

    function collectSegments() {
        const segments = document.querySelectorAll('ytd-transcript-segment-renderer');
        const parsed = [];
        segments.forEach(seg => {
            const tsEl = seg.querySelector('.segment-timestamp');
            const textEl = seg.querySelector('.segment-text') || seg.querySelector('yt-formatted-string');
            if (!tsEl || !textEl) return;
            const timestamp = tsEl.innerText.trim();
            const text = textEl.innerText.trim();
            if (text) {
                parsed.push({ timestamp, seconds: parseTimestampToSeconds(timestamp), text });
            }
        });
        return parsed;
    }

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

    function downloadTranscript() {
        const parsed = collectSegments();
        if (!parsed.length) {
            alert('No transcript segments found.\nMake sure the transcript panel is open.');
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
        URL.revokeObjectURL(blobUrl);
    }

    function getApiKey() {
        let key = GM_getValue(API_KEY_STORE, '');
        if (!key) {
            key = prompt('Wklej swój klucz API Mistral (https://console.mistral.ai):');
            if (key) {
                key = key.trim();
                GM_setValue(API_KEY_STORE, key);
            }
        }
        return key;
    }

    function summarizeTranscript() {
        const parsed = collectSegments();
        if (!parsed.length) {
            alert('No transcript segments found.\nMake sure the transcript panel is open.');
            return;
        }

        const apiKey = getApiKey();
        if (!apiKey) return;

        const data = buildData(parsed);
        showPopup('⏳ Generuję streszczenie...', true);

        const prompt = [
            'Streść poniższy transkrypt filmu z YouTube w formie listy najważniejszych punktów kluczowych.',
            'Pisz po polsku. Używaj zwięzłych bulletów (zaczynaj od "- "). Pomiń wtręty, dygresje i powtórzenia.',
            '',
            `Tytuł filmu: ${data.title}`,
            '',
            'TRANSKRYPT:',
            data.fullText
        ].join('\n');

        const MAX_RETRIES = 4;

        function parseRetryAfter(res, attempt) {
            let secs = 0;
            const hdr = res.responseHeaders || '';
            const m = hdr.match(/retry-after:\s*(\d+)/i);
            if (m) secs = parseInt(m[1], 10);
            if (!secs) secs = Math.min(60, Math.pow(2, attempt) * 5);
            return secs;
        }

        function countdownThenRetry(seconds, attempt) {
            let left = seconds;
            const tick = () => {
                if (!document.getElementById(POPUP_ID)) return;
                showPopup(`⏳ Przekroczono limit zapytań Mistral.\nPonawiam za ${left}s... (próba ${attempt + 1}/${MAX_RETRIES})`, true);
                if (left <= 0) { sendRequest(attempt + 1); return; }
                left--;
                setTimeout(tick, 1000);
            };
            tick();
        }

        function sendRequest(attempt) {
            GM_xmlhttpRequest({
                method: 'POST',
                url: MISTRAL_ENDPOINT,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                data: JSON.stringify({
                    model: MISTRAL_MODEL,
                    messages: [{ role: 'user', content: prompt }]
                }),
                onload: function (res) {
                    if (res.status === 401) {
                        GM_setValue(API_KEY_STORE, '');
                        showPopup('❌ Nieprawidłowy klucz API. Kliknij ponownie, aby wpisać nowy.', false);
                        return;
                    }
                    if (res.status === 429) {
                        if (attempt >= MAX_RETRIES) {
                            showPopup('❌ Limit zapytań Mistral przekroczony mimo ponawiania.\n\nDarmowy tier ma limit tokenów na minutę — odczekaj chwilę (lub minutę przy długim filmie) i kliknij ponownie.', false);
                            return;
                        }
                        countdownThenRetry(parseRetryAfter(res, attempt), attempt);
                        return;
                    }
                    if (res.status < 200 || res.status >= 300) {
                        showPopup(`❌ Błąd API (HTTP ${res.status}):\n${res.responseText.slice(0, 500)}`, false);
                        return;
                    }
                    try {
                        const json = JSON.parse(res.responseText);
                        const summary = json.choices?.[0]?.message?.content?.trim();
                        if (summary) {
                            showPopup(summary, false);
                        } else {
                            showPopup('❌ Pusta odpowiedź od API.', false);
                        }
                    } catch (e) {
                        showPopup('❌ Nie udało się sparsować odpowiedzi API.', false);
                    }
                },
                onerror: function () {
                    showPopup('❌ Błąd sieci podczas połączenia z Mistral API.', false);
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
            'line-height: 1.6',
            'font-size: 14.5px', loading ? 'opacity: .7' : ''
        ].join(';');
        if (loading) {
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
                makeButton(SUM_BUTTON_ID, '✨ Streść (Mistral)', 76, '#5a3fd6', '#472fb0', summarizeTranscript)
            );
        }
    }

    function removeButtons() {
        document.getElementById(DL_BUTTON_ID)?.remove();
        document.getElementById(SUM_BUTTON_ID)?.remove();
    }

    function checkAndInject() {
        if (document.querySelector('ytd-transcript-segment-renderer')) {
            injectButtons();
        } else {
            removeButtons();
        }
    }

    function startObserver() {
        domObserver?.disconnect();
        domObserver = new MutationObserver(checkAndInject);
        domObserver.observe(document.body, { childList: true, subtree: true });
    }

    if (typeof GM_registerMenuCommand === 'function') {
        GM_registerMenuCommand('Resetuj klucz API Mistral', () => {
            GM_setValue(API_KEY_STORE, '');
            alert('Klucz API Mistral został usunięty. Przy następnym streszczeniu skrypt poprosi o nowy.');
        });
    }

    window.addEventListener('yt-navigate-finish', () => {
        removeButtons();
        closePopup();
        startObserver();
    });

    startObserver();
})();
