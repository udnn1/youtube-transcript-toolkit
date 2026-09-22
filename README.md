# YouTube Transcript Toolkit

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
