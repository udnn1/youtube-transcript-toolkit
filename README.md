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

Lekki skrypt Tampermonkey, który dodaje trzy przyciski na stronach z filmami YouTube:

- **⬇ Pobierz JSON** - eksportuje całą transkrypcję jako uporządkowany plik JSON
- **📋 Kopiuj transkrypt** - kopiuje całą transkrypcję (z timestampami) do schowka, gotową do wklejenia np. do czatu z AI
- **✨ Streść (Gemini)** - generuje streszczenie filmu w punktach kluczowych (po polsku) i pokazuje je w okienku, korzystając z API Google Gemini (darmowy klucz z Google AI Studio)

Przydatny do budowania przeszukiwalnych archiwów, tworzenia notatek z timestampami, cytowania konkretnych fragmentów filmu lub błyskawicznego ogarnięcia o czym jest długi film bez oglądania go w całości.

---

## Funkcje

- **Trzy przyciski** - pobieranie JSON, kopiowanie do schowka oraz streszczenie AI, widoczne na każdej stronie z filmem (`/watch`)
- **Kopiowanie jednym kliknięciem** - tytuł, link i każda linia w formacie `[MM:SS] tekst` trafiają do schowka; przycisk potwierdza liczbę skopiowanych linii
- **Automatyczne otwieranie transkrypcji** - jeśli panel transkrypcji jest zamknięty, skrypt sam rozwija opis i go otwiera
- **Strukturalny JSON** - każdy segment z timestampem (zarówno jako `MM:SS`, jak i liczba sekund) plus tytuł, URL, ID filmu i data eksportu
- **Pole `fullText`** - całość transkrypcji sklejona w jeden tekst do szybkiego skopiowania
- **Streszczenia w punktach** - przez API Google Gemini (domyślnie model `gemini-flash-latest`), wynik w czytelnym popupie
- **Automatyczny wybór modelu** - skrypt pobiera z API listę modeli dostępnych dla Twojego klucza i wybiera najlepszy tekstowy model Flash; nie trzeba ręcznie śledzić nazw ani wycofywanych wersji
- **Modele zapasowe** - kolejka naprzemiennie zawiera modele Flash i Flash-Lite (osobne pule mocy i limitów); przy 404 model jest pomijany, a przy limicie (HTTP 429) lub przeciążeniu (HTTP 500/503) skrypt przechodzi na kolejny model, a gdy wszystkie są zajęte - odczekuje i ponawia całą kolejkę
- **Zmiana modelu** - dowolny model Gemini ustawisz z menu Tampermonkey (menu pokazuje listę modeli dostępnych dla Twojego klucza)
- **Automatyczne ponawianie** - do 3 prób z odliczaniem, z uwzględnieniem czasu oczekiwania podanego przez API
- **Czytelne komunikaty błędów** - podpowiedzi dla nieprawidłowego klucza, braku dostępu (403), regionu bez dostępu do API, niedostępnych modeli, przekroczonego czasu i zablokowanego połączenia
- **Sformatowane streszczenie** - Markdown (nagłówki, pogrubienia, kursywa, `kod`, zagnieżdżone listy) renderowany w okienku
- **Klucz API poza kodem** - zapisywany lokalnie w Tampermonkey, wysyłany tylko do Google w nagłówku `x-goog-api-key`
- **Obsługa dwóch wariantów panelu transkrypcji** - zarówno klasycznego (`ytd-transcript-segment-renderer`), jak i nowego "modern transcript view" (`transcript-segment-view-model`)
- **Obsługa SPA** - radzi sobie z nawigacją YouTube bez przeładowania strony
- **Zero zależności** - czysty vanilla JS, bez zewnętrznych bibliotek

---

## Instalacja

1. Zainstaluj menedżer userscriptów:
   - [Tampermonkey](https://www.tampermonkey.net/) (Chrome, Firefox, Edge, Safari)
   - [Violentmonkey](https://violentmonkey.github.io/) (Chrome, Firefox)

   > Greasemonkey 4+ nie jest obsługiwany - nie udostępnia funkcji `GM_*` (np. `GM_xmlhttpRequest`), z których korzysta skrypt.

2. Kliknij ikonę menedżera w pasku przeglądarki → **Utwórz nowy skrypt**.

3. Zastąp domyślną zawartość treścią pliku [`youtube-transcript-downloader.user.js`](./youtube-transcript-downloader.user.js).

4. Zapisz (`Ctrl+S` / `Cmd+S`).

5. Przy pierwszym streszczeniu menedżer może zapytać o zgodę na połączenie z `generativelanguage.googleapis.com` - zezwól.

---

## Konfiguracja API Gemini (opcjonalna - tylko dla streszczeń)

Pobieranie JSON i kopiowanie transkryptu działają bez żadnej konfiguracji. Streszczenia AI wymagają klucza API Gemini:

1. Wejdź na [aistudio.google.com/apikey](https://aistudio.google.com/apikey) i zaloguj się kontem Google.
2. Kliknij **Create API key** → skopiuj klucz.
3. Przy pierwszym kliknięciu **✨ Streść (Gemini)** skrypt poprosi o wklejenie klucza (spacje, cudzysłowy i prefiks `Bearer` są usuwane automatycznie).
4. Klucz zostaje zapisany lokalnie (przez `GM_setValue`) - nie trzeba go wpisywać ponownie. Jeśli Google odrzuci klucz, skrypt sam go usunie i przy następnym kliknięciu poprosi o nowy.

> Darmowy tier Gemini ma limity zapytań (na minutę, tokenów na minutę i na dzień). Przy błędzie 429/503 skrypt przełącza się na kolejny dostępny model i ponawia próbę. Jeśli wyczerpiesz limit **dzienny**, trzeba poczekać do resetu - północ czasu pacyficznego (ok. 9:00 w Polsce). Swoje limity sprawdzisz w AI Studio → **Usage / Rate limits**.

> **Prywatność:** klucz jest przechowywany w Tampermonkey jako zwykły tekst (bez szyfrowania) - nie udostępniaj eksportu/kopii zapasowej Tampermonkey z danymi skryptów. Do Google wysyłany jest tytuł filmu i pełna treść transkrypcji.

---

## Użycie

1. Otwórz dowolny film na YouTube, który ma dostępną transkrypcję.
2. W prawym dolnym rogu pojawią się trzy przyciski:
   - **⬇ Pobierz JSON** → pobiera plik `transcript_<videoId>.json`
   - **📋 Kopiuj transkrypt** → kopiuje całą transkrypcję do schowka (przycisk pokaże „✅ Skopiowano”)
   - **✨ Streść (Gemini)** → otwiera popup ze streszczeniem w punktach kluczowych
3. Nie musisz ręcznie otwierać transkrypcji - skrypt zrobi to sam. Jeśli mu się nie uda, rozwiń opis filmu i kliknij **Pokaż transkrypcję**, a potem spróbuj ponownie.
4. Popup zamkniesz klawiszem `Esc`, przyciskiem `✕` lub klikając poza okienkiem.

### Przykładowy JSON

```json
{
  "title": "Tytuł filmu",
  "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "videoId": "dQw4w9WgXcQ",
  "exportedAt": "2026-09-13T10:00:00.000Z",
  "segments": [
    { "timestamp": "0:00", "seconds": 0, "text": "Pierwsze zdanie..." },
    { "timestamp": "0:04", "seconds": 4, "text": "Drugie zdanie..." }
  ],
  "fullText": "Pierwsze zdanie... Drugie zdanie..."
}
```

### Format kopiowanego tekstu

```text
Tytuł filmu
https://www.youtube.com/watch?v=dQw4w9WgXcQ

[0:00] Pierwsze zdanie...
[0:04] Drugie zdanie...
```

---

## Menu skryptu

Kliknij ikonę Tampermonkey w pasku przeglądarki (będąc na stronie YouTube):

- **Resetuj klucz API Gemini** - usuwa zapisany klucz; przy następnym streszczeniu skrypt poprosi o nowy
- **Zmień model Gemini** - okno pokazuje modele dostępne dla Twojego klucza; wpisz nazwę (np. `gemini-3.6-flash`, pełna lista: [ai.google.dev/gemini-api/docs/models](https://ai.google.dev/gemini-api/docs/models)). Puste pole = automatyczny wybór (zaczynając od `gemini-flash-latest`)

> Jeśli ręcznie ustawiony model zniknie z listy (np. zostanie wycofany - jak rodzina `gemini-2.5-*` dla nowych kont), skrypt go pominie i sam wybierze inny dostępny model.

---

## Rozwiązywanie problemów

| Komunikat | Co zrobić |
| --- | --- |
| **HTTP 0 / błąd sieci** | Sprawdź, czy Tampermonkey nie blokuje domeny `generativelanguage.googleapis.com`; wyłącz na chwilę adblock / VPN / firewall |
| **Gemini odrzucił klucz API** | Skopiuj klucz ponownie z AI Studio - stary został już usunięty |
| **Brak dostępu (403)** | Włącz **Generative Language API** w projekcie Google Cloud klucza; sprawdź restrykcje klucza (restrykcja „HTTP referrer” nie działa z Tampermonkey) i dostępność Gemini w Twoim regionie |
| **Żaden z modeli Gemini nie jest dostępny** | Otwórz menu **Zmień model Gemini** - zobaczysz listę modeli dostępnych dla klucza - i wpisz jeden z nich |
| **Przycisk streszczenia nic nie robi** | Otwórz konsolę przeglądarki (F12) i poszukaj wpisów `[YT Transcript]` - zawierają kod HTTP i treść odpowiedzi API |
| **Wyczerpany limit / przeciążenie** | Poczekaj chwilę; przy limicie dziennym - do ok. 9:00 następnego dnia |
| **Nie udało się pobrać transkrypcji** | Film może nie mieć napisów - spróbuj otworzyć panel transkrypcji ręcznie |
| **Nie udało się skopiować** | Upewnij się, że menedżer skryptów ma uprawnienie `GM_setClipboard` (po aktualizacji skryptu Tampermonkey może poprosić o zgodę) |

---

## Licencja

MIT - rób co chcesz.

---

## Zgłoszenia

Issues i pull requesty są mile widziane - szczególnie jeśli YouTube zmieni nazwy klas i skrypt przestanie działać.
