// ==UserScript==
// @name         YouTube Transcript Downloader
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Download YouTube transcripts as a JSON file
// @match        https://www.youtube.com/watch*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const BUTTON_ID = 'yt-transcript-dl-btn';
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

    function downloadTranscript() {
        const segments = document.querySelectorAll('ytd-transcript-segment-renderer');

        if (!segments.length) {
            alert('No transcript segments found.\nMake sure the transcript panel is open.');
            return;
        }

        const parsedSegments = [];
        segments.forEach(seg => {
            const tsEl = seg.querySelector('.segment-timestamp');
            const textEl = seg.querySelector('.segment-text') || seg.querySelector('yt-formatted-string');
            if (!tsEl || !textEl) return;

            const timestamp = tsEl.innerText.trim();
            const text = textEl.innerText.trim();
            if (text) {
                parsedSegments.push({
                    timestamp,
                    seconds: parseTimestampToSeconds(timestamp),
                    text
                });
            }
        });

        if (!parsedSegments.length) {
            alert('Extracted 0 segments — YouTube DOM may have changed.\nCheck the console (F12).');
            console.warn('[YT Transcript DL] No segments found.');
            return;
        }

        const videoId = getVideoId();
        const data = {
            title: getVideoTitle(),
            url: `https://www.youtube.com/watch?v=${videoId}`,
            videoId,
            exportedAt: new Date().toISOString(),
            segments: parsedSegments,
            fullText: parsedSegments.map(s => s.text).join(' ')
        };

        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = `transcript_${videoId}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(blobUrl);
    }

    function injectButton() {
        if (document.getElementById(BUTTON_ID)) return;

        const btn = document.createElement('button');
        btn.id = BUTTON_ID;
        btn.textContent = '⬇ Download transcript (JSON)';
        btn.title = 'Download the full transcript as JSON';
        btn.style.cssText = [
            'position: fixed',
            'bottom: 24px',
            'right: 24px',
            'padding: 12px 18px',
            'background: #ff0000',
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
            'z-index: 2147483647',
        ].join(';');

        btn.addEventListener('mouseenter', () => { btn.style.background = '#c00'; });
        btn.addEventListener('mouseleave', () => { btn.style.background = '#ff0000'; });
        btn.addEventListener('mousedown', () => { btn.style.transform = 'scale(.96)'; });
        btn.addEventListener('mouseup', () => { btn.style.transform = 'scale(1)'; });
        btn.addEventListener('click', downloadTranscript);

        document.body.appendChild(btn);
    }

    function removeButton() {
        document.getElementById(BUTTON_ID)?.remove();
    }

    function checkAndInject() {
        const hasSegments = document.querySelector('ytd-transcript-segment-renderer');
        if (hasSegments) {
            injectButton();
        } else {
            removeButton();
        }
    }

    function startObserver() {
        domObserver?.disconnect();
        domObserver = new MutationObserver(checkAndInject);
        domObserver.observe(document.body, { childList: true, subtree: true });
    }

    window.addEventListener('yt-navigate-finish', () => {
        removeButton();
        startObserver();
    });

    startObserver();
})();
