<div align="center">

# 🎬 YouTube Transcript Toolkit ✨

### ⚡ Pobieraj transkrypcje YouTube do JSON lub streszczaj je AI jednym kliknięciem ⚡

<p>
  <img src="https://img.shields.io/badge/Tampermonkey-00485B?style=for-the-badge&logo=tampermonkey&logoColor=white" alt="Tampermonkey" />
  <img src="https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black" alt="JavaScript" />
  <img src="https://img.shields.io/badge/YouTube-FF0000?style=for-the-badge&logo=youtube&logoColor=white" alt="YouTube" />
  <img src="https://img.shields.io/badge/Mistral_AI-FA520F?style=for-the-badge&logo=mistralai&logoColor=white" alt="Mistral AI" />
  <img src="https://img.shields.io/badge/License-MIT-green?style=for-the-badge" alt="MIT License" />
</p>

<p>
  <b>🚀 Zero zależności</b> &nbsp;•&nbsp;
  <b>📦 Jeden plik</b> &nbsp;•&nbsp;
  <b>⏱️ Pełne timestampy</b> &nbsp;•&nbsp;
  <b>✨ Streszczenia AI</b> &nbsp;•&nbsp;
  <b>🔄 Obsługa SPA</b>
</p>

</div>

---

Lekki skrypt Tampermonkey, który dodaje dwa przyciski na stronach z filmami YouTube:

- **⬇ Pobierz JSON** - eksportuje całą transkrypcję jako uporządkowany plik JSON
- **✨ Streść (Mistral)** - generuje streszczenie filmu w punktach kluczowych i pokazuje je w okienku, korzystając z darmowego API Mistral AI

Przydatny do budowania przeszukiwalnych archiwów, tworzenia notatek z timestampami, cytowania konkretnych fragmentów filmu lub błyskawicznego ogarnięcia o czym jest długi film bez oglądania go w całości (szczególnie zagraniczne podcasty).

---

## Funkcje

- **Dwa przyciski** - pobieranie JSON oraz streszczenie AI, pojawiają się gdy panel transkrypcji jest otwarty
- **Strukturalny JSON** - każdy segment z timestampem (zarówno jako `MM:SS`, jak i liczba sekund)
- **Pole `fullText`** - całość transkrypcji sklejona w jeden tekst do szybkiego skopiowania
- **Streszczenia w punktach** - przez API Mistral AI (model `mistral-medium-latest`), wynik w czytelnym popupie
- **Sformatowane streszczenie** - Markdown (nagłówki, pogrubienia, zagnieżdżone listy) renderowany w okienku
- **Automatyczne ponawianie** - przy przekroczeniu limitu (HTTP 429) skrypt sam czeka i próbuje ponownie z odliczaniem
- **Bezpieczne przechowywanie klucza** - klucz API zapisywany lokalnie w Tampermonkey, nigdy w kodzie
- **Obsługa SPA** - radzi sobie z nawigacją YouTube bez przeładowania strony
- **Zero zależności** - czysty vanilla JS, bez zewnętrznych bibliotek

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

## Konfiguracja API Mistral (opcjonalna - tylko dla streszczeń)

Pobieranie JSON działa bez żadnej konfiguracji. Streszczenia AI wymagają darmowego klucza API:

1. Załóż konto na [console.mistral.ai](https://console.mistral.ai).
2. Przejdź do **API Keys** → **Create new key** → skopiuj klucz.
3. Przy pierwszym kliknięciu **✨ Streść (Mistral)** skrypt poprosi o wklejenie klucza.
4. Klucz zostaje zapisany lokalnie (przez `GM_setValue`) - nie trzeba go wpisywać ponownie.

> Darmowy tier Mistral ma limity zapytań (zapytań/s oraz tokenów/min). Skrypt automatycznie ponawia próbę przy błędzie 429. Bardzo długie filmy (kilka godzin) mogą przekroczyć limit tokenów na minutę - w takim wypadku odczekaj chwilę i kliknij ponownie.

---

## Użycie

1. Otwórz dowolny film na YouTube, który ma dostępną transkrypcję.
2. Kliknij menu `...` pod filmem → **Wyświetl transkrypcję**.
3. W prawym dolnym rogu pojawią się dwa przyciski:
   - **⬇ Pobierz JSON** → pobiera plik `transcript_<videoId>.json`
   - **✨ Streść (Mistral)** → otwiera popup ze streszczeniem w punktach kluczowych
4. Popup zamkniesz klawiszem `Esc`, przyciskiem `✕` lub klikając poza okienkiem.

---

## Samodzielne rozwiązywanie problemów

**Przycisk nie pojawia się po otwarciu panelu transkrypcji.**

Otwórz konsolę przeglądarki (`F12` → zakładka **Console**) i wpisz:

```js
document.querySelectorAll('ytd-transcript-segment-renderer').length
```

- **Wynik > 0** → segmenty są obecne. Przewiń stronę - przycisk może być zasłonięty przez inny element.
- **Wynik 0** → YouTube zmienił strukturę DOM. Zgłoś [issue](../../issues) z informacją o wersji przeglądarki.

**Pobrany plik jest pusty / ma 0 segmentów.**

Panel transkrypcji musi być w pełni wyrenderowany (musisz widzieć przewijaną listę segmentów) zanim klikniesz przycisk.

**Streszczenie pokazuje błąd 429 / limit zapytań.**

Skrypt automatycznie ponawia próbę (do 4 razy, z rosnącą przerwą 5→10→20→40 s). Jeśli mimo to się nie uda - film jest zbyt długi jak na limit tokenów/min darmowego tieru. Odczekaj minutę i kliknij ponownie.

**Streszczenie zwraca błąd 401 / nieprawidłowy klucz.**

Skrypt automatycznie kasuje błędny klucz. Kliknij przycisk streszczenia ponownie i wpisz poprawny klucz z [console.mistral.ai](https://console.mistral.ai).

**Chcę zmienić zapisany klucz API.**

Kliknij ikonę Tampermonkey w pasku przeglądarki (będąc na stronie YouTube) → z menu wybierz **Resetuj klucz API Mistral**. Klucz zostanie usunięty, a przy następnym streszczeniu skrypt poprosi o nowy.

---

## Licencja

MIT - rób co chcesz.

---

## Współpraca

Issues i pull requesty są mile widziane. Jeśli YouTube zmieni nazwy klas i skrypt przestanie działać, dołącz do zgłoszenia wynik komendy:

```js
document.querySelector('ytd-transcript-segment-renderer')?.outerHTML
```
