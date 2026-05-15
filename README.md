<div align="center">

# 🎬 YouTube Transcript Downloader 📥

### ⚡ Eksport transkrypcji YouTube do JSON jednym kliknięciem ⚡

<p>
  <img src="https://img.shields.io/badge/Tampermonkey-00485B?style=for-the-badge&logo=tampermonkey&logoColor=white" alt="Tampermonkey" />
  <img src="https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black" alt="JavaScript" />
  <img src="https://img.shields.io/badge/YouTube-FF0000?style=for-the-badge&logo=youtube&logoColor=white" alt="YouTube" />
  <img src="https://img.shields.io/badge/License-MIT-green?style=for-the-badge" alt="MIT License" />
</p>

<p>
  <b>🚀 Zero zależności</b> &nbsp;•&nbsp;
  <b>📦 Jeden plik</b> &nbsp;•&nbsp;
  <b>⏱️ Pełne timestampy</b> &nbsp;•&nbsp;
  <b>🔄 Obsługa SPA</b>
</p>

</div>

---

Lekki skrypt Tampermonkey, który dodaje pływający przycisk na stronach z filmami YouTube. Jedno kliknięcie eksportuje całą transkrypcję jako uporządkowany plik JSON.

Przydatny do budowania przeszukiwalnych archiwów, tworzenia notatek z timestampami, cytowania konkretnych fragmentów filmu lub po prostu szybkiego pozyskania pełnego tekstu wypowiedzi.

---

## Funkcje

- **Eksport jednym kliknięciem** — pływający przycisk pojawia się zawsze, gdy panel transkrypcji jest otwarty
- **Strukturalny JSON** — każdy segment z timestampem (zarówno jako `MM:SS`, jak i liczba sekund)
- **Pole `fullText`** — całość transkrypcji sklejona w jeden tekst do szybkiego skopiowania
- **Obsługa SPA** — radzi sobie z nawigacją YouTube bez przeładowania strony
- **Zero zależności** — czysty vanilla JS, bez zewnętrznych bibliotek
- **Mały rozmiar** — poniżej 150 linii, jeden plik

---

## Instalacja

1. Zainstaluj menedżer userscriptów:
   - [Tampermonkey](https://www.tampermonkey.net/) (Chrome, Firefox, Edge, Safari)
   - [Violentmonkey](https://violentmonkey.github.io/) (Chrome, Firefox)
   - [Greasemonkey](https://www.greasespot.net/) (Firefox)

2. Kliknij ikonę menedżera w pasku przeglądarki → **Utwórz nowy skrypt**.

3. Zastąp domyślną zawartość treścią pliku [`youtube-transcript-downloader.user.js`](./youtube-transcript-downloader.user.js).

4. Zapisz (`Ctrl+S` / `Cmd+S`).

---

## Użycie

1. Otwórz dowolny film na YouTube, który ma dostępną transkrypcję.
2. Kliknij menu `...` pod filmem → **Wyświetl transkrypcję**.
3. W prawym dolnym rogu pojawi się czerwony przycisk **⬇ Download transcript (JSON)**.
4. Kliknij → pobiera się plik `transcript_<videoId>.json`.

---

## Format pliku wynikowego

```json
{
  "title": "Tytuł filmu",
  "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "videoId": "dQw4w9WgXcQ",
  "exportedAt": "2026-05-15T10:30:00.000Z",
  "segments": [
    { "timestamp": "0:00", "seconds": 0,  "text": "Witajcie w tym filmie" },
    { "timestamp": "0:05", "seconds": 5,  "text": "Dzisiaj omówimy..." },
    { "timestamp": "0:12", "seconds": 12, "text": "podstawy tematu..." }
  ],
  "fullText": "Witajcie w tym filmie Dzisiaj omówimy... podstawy tematu..."
}
```

| Pole         | Opis                                                              |
| ------------ | ----------------------------------------------------------------- |
| `title`      | Tytuł filmu (bez sufiksu " - YouTube")                            |
| `url`        | Kanoniczny adres URL filmu                                        |
| `videoId`    | Identyfikator filmu wyciągnięty z URL                             |
| `exportedAt` | Znacznik czasu ISO 8601 momentu eksportu                          |
| `segments[]` | Tablica `{ timestamp, seconds, text }` dla każdej linii transkrypcji |
| `fullText`   | Cały tekst transkrypcji sklejony spacjami                         |

---

## Rozwiązywanie problemów

**Przycisk nie pojawia się po otwarciu panelu transkrypcji.**

Otwórz konsolę przeglądarki (`F12` → zakładka **Console**) i wpisz:

```js
document.querySelectorAll('ytd-transcript-segment-renderer').length
```

- **Wynik > 0** → segmenty są obecne. Przewiń stronę — przycisk może być zasłonięty przez inny element.
- **Wynik 0** → YouTube zmienił strukturę DOM. Zgłoś [issue](../../issues) z informacją o wersji przeglądarki.

**Pobrany plik jest pusty / ma 0 segmentów.**

Panel transkrypcji musi być w pełni wyrenderowany (musisz widzieć przewijaną listę segmentów) zanim klikniesz przycisk.

---

## Jak to działa

`MutationObserver` obserwuje stronę pod kątem pojawienia się elementów `ytd-transcript-segment-renderer`. Gdy wykryje przynajmniej jeden segment, skrypt wstrzykuje przycisk z pozycjonowaniem fixed. Kliknięcie przycisku iteruje po każdym segmencie, wyciąga timestamp i tekst za pomocą selektorów `.segment-timestamp` i `.segment-text`, pakuje wszystko do obiektu JSON i uruchamia pobieranie przez Blob.

Nawigacja SPA YouTube jest obsługiwana przez event `yt-navigate-finish`, który ponownie podpina observer przy każdej zmianie filmu.

---

## Licencja

MIT — rób co chcesz.

---

## Współpraca

Issues i pull requesty są mile widziane. Jeśli YouTube zmieni nazwy klas i skrypt przestanie działać, dołącz do zgłoszenia wynik komendy:

```js
document.querySelector('ytd-transcript-segment-renderer')?.outerHTML
```
