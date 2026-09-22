<div align="center">

# 🎬 YouTube Transcript Toolkit ✨

### ⚡ Pobieraj, kopiuj lub streszczaj transkrypcje YouTube jednym kliknięciem ⚡

<p>
  <img src="https://img.shields.io/badge/Tampermonkey-00485B?style=for-the-badge&logo=tampermonkey&logoColor=white" alt="Tampermonkey" />
  <img src="https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black" alt="JavaScript" />
  <img src="https://img.shields.io/badge/YouTube-FF0000?style=for-the-badge&logo=youtube&logoColor=white" alt="YouTube" />
  <img src="https://img.shields.io/badge/Google_Gemini-8E75B2?style=for-the-badge&logo=googlegemini&logoColor=white" alt="Google Gemini" />
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

Skrypt Tampermonkey, który dodaje trzy przyciski w rzędzie akcji pod filmem YouTube:

- **⬇ JSON** - pobiera całą transkrypcję jako plik JSON
- **📋 Kopiuj** - kopiuje transkrypcję z timestampami (`[MM:SS] tekst`) do schowka
- **✨ Streść** - generuje streszczenie filmu w punktach (po polsku) przez API Google Gemini

Skrypt sam otwiera panel transkrypcji, jeśli jest zamknięty. Działa z nawigacją SPA YouTube, bez zewnętrznych bibliotek.

## Instalacja

1. Zainstaluj [Tampermonkey](https://www.tampermonkey.net/) (lub [Violentmonkey](https://violentmonkey.github.io/)).
2. Otwórz surowy plik skryptu: [`youtube-transcript-downloader.user.js`](https://raw.githubusercontent.com/udnn1/youtube-transcript-toolkit/main/youtube-transcript-downloader.user.js) - menedżer zaproponuje instalację.
3. Zatwierdź.

Skrypt ma `@updateURL` / `@downloadURL`, więc kolejne wersje zaktualizują się automatycznie.

## Klucz API Gemini (tylko dla streszczeń)

Pobieranie JSON i kopiowanie działają bez konfiguracji. Streszczenia wymagają klucza:

1. Wygeneruj klucz na [aistudio.google.com/apikey](https://aistudio.google.com/apikey).
2. Przy pierwszym kliknięciu **✨ Streść** wklej klucz - zostanie zapisany lokalnie w Tampermonkey.

Do Google wysyłany jest tytuł filmu i pełna treść transkrypcji.

## Użycie

Otwórz film z dostępną transkrypcją i kliknij jeden z przycisków w rzędzie akcji (obok Lubię to / Udostępnij). Popup streszczenia zamkniesz klawiszem `Esc`, przyciskiem `✕` lub kliknięciem poza okienkiem.

## Licencja

MIT
