# 📚 Bibliotekarz

![CI](https://github.com/siuchaj1973-art/Bibliotekarz/actions/workflows/ci.yml/badge.svg)
![Docker](https://github.com/siuchaj1973-art/Bibliotekarz/actions/workflows/docker.yml/badge.svg)

**Profesjonalny, samodzielny menedżer e-booków i audiobooków.** Działa lokalnie
lub w chmurze. Powstał jako odpowiedź na ograniczenia Calibre, które nie zarządza
poprawnie audiobookami — Bibliotekarz traktuje audiobooki jak pełnoprawnych
obywateli: rozdziały, lektorzy, wznawianie odtwarzania, prędkość, timer snu.

To nie jest demo ani prototyp — to kompletna, działająca aplikacja z serwerem API,
skanerem biblioteki, wbudowanym czytnikiem EPUB/PDF, odtwarzaczem audiobooków oraz
katalogiem OPDS dla zewnętrznych czytników.

---

## ✨ Możliwości

### Wspólne
- **Skaner biblioteki** — indeksuje folder z plikami (nigdy ich nie modyfikuje),
  wykrywa zmiany po hashu SHM (szybki re-skan bez ponownego hashowania).
- **Bogate metadane** — tytuł, autorzy, seria + numer, wydawca, rok, język, ISBN,
  opis, tagi, okładka, ocena.
- **Automatyczna ekstrakcja metadanych** z plików: EPUB (Dublin Core + Calibre),
  PDF (Info/XMP), audio (ID3/Vorbis/MP4).
- **Pełnotekstowe wyszukiwanie** (SQLite FTS5, z ignorowaniem znaków diakrytycznych)
  po tytule, autorze, lektorze, serii, tagach i opisie.
- **Przeglądanie** po autorach, seriach, tagach oraz **kolekcje/półki** definiowane
  przez użytkownika.
- **Edytor metadanych** w interfejsie webowym.
- **Katalog OPDS 1.2** — podłącz KOReader, Moon+ Reader, Librera, Thorium itp.
- **Śledzenie postępu** — status (nieprzeczytane / w trakcie / ukończone) i procent.
- **Import z Calibre** — migracja metadanych i okładek z istniejącej biblioteki
  Calibre (`metadata.db`) bez kopiowania plików.

### E-booki
- **Wbudowany czytnik EPUB** — renderowanie spine, spis treści, nawigacja
  klawiaturą, zapamiętywanie pozycji, tryb sepia/ciemny.
- **Czytnik PDF** (natywny podgląd przeglądarki).
- Obsługa formatów: EPUB, PDF, MOBI/AZW3, FB2, CBZ/CBR, DjVu, TXT
  (metadane i pobieranie; czytnik dla EPUB/PDF).
- **Wiele formatów jednej książki** (np. EPUB + MOBI) grupowane w jedną pozycję.

### Audiobooki  ⭐ (to, czego brakuje w Calibre)
- **Rozdziały** — z osadzonych rozdziałów `.m4b` (Nero `chpl`) lub gdy audiobook
  to folder plików, każdy plik staje się rozdziałem, z prawidłową osią czasu.
- **Odtwarzacz** z pełną osią czasu obejmującą wiele plików, przewijaniem między
  rozdziałami, cofaniem 15 s / przewijaniem 30 s.
- **Wznawianie** dokładnie w miejscu, w którym skończyłeś (postęp zapisywany na serwerze).
- **Regulacja prędkości** (0,75×–2×) i **timer snu**.
- **Lektorzy** jako osobne pole metadanych.
- Streaming z obsługą HTTP Range (przewijanie bez pobierania całości).
- Obsługa formatów: M4B, M4A, MP3, OGG/Opus, FLAC, AAC, WAV.

---

## 🚀 Szybki start (lokalnie)

Wymagania: **Node.js ≥ 22.5** (używa wbudowanego `node:sqlite` — brak natywnej
kompilacji).

```bash
# 1. Instalacja zależności
npm install

# 2. Konfiguracja
cp .env.example .env
#   ustaw LIBRARY_DIR na folder ze swoimi plikami

# 3. Budowanie interfejsu i serwera
npm run build

# 4. Pierwszy skan biblioteki
npm run scan

# 5. Start
npm start
#   → http://localhost:4321
```

### Tryb deweloperski
```bash
npm run dev     # serwer (tsx --watch) + Vite z hot-reload na :5173
```

---

## 🐳 Uruchomienie w chmurze / Docker

```bash
# 1. (opcjonalnie) skonfiguruj przez zmienne środowiskowe lub .env
export LIBRARY_DIR=/sciezka/do/twoich/plikow
export AUTH_TOKEN=dlugi-losowy-sekret        # wymagane przy wystawieniu do internetu

# 2. Zbuduj i uruchom
docker compose up -d --build
#    → http://localhost:4321
```

Obraz jest **wieloetapowy** (build → runtime), działa jako **użytkownik nie-root**,
ma wbudowany **HEALTHCHECK** (`/healthz`) i przy starcie wykonuje przyrostowy skan
biblioteki (`SCAN_ON_START=true`), więc katalog jest gotowy zaraz po `up`.

- `LIBRARY_DIR` montowany jest **tylko do odczytu** — pliki nie są modyfikowane.
- Baza i okładki trzymane są w **nazwanym wolumenie** `bibliotekarz-data` (bez
  problemów z uprawnieniami hosta dla użytkownika nie-root).
- `AUTH_TOKEN` — gdy ustawiony, każde żądanie `/api` i `/opds` musi zawierać
  `Authorization: Bearer <token>` lub `?token=<token>` (UI pyta o token w Ustawieniach).
  Endpoint `/healthz` pozostaje publiczny.

**Sieci z ograniczeniami** (bez dostępu do Docker Hub): wskaż lustro obrazu bazowego —
```bash
docker compose build --build-arg NODE_IMAGE=moje-lustro/node:22-alpine
# lub:  NODE_IMAGE=moje-lustro/node:22-alpine docker compose up -d --build
```

Uruchomienie bez Compose:
```bash
docker build -t bibliotekarz .
docker run -d -p 4321:4321 \
  -v /sciezka/do/plikow:/library:ro \
  -v bibliotekarz-data:/data \
  -e AUTH_TOKEN=sekret \
  --name bibliotekarz bibliotekarz
```

---

## 📂 Jak organizować bibliotekę

Skaner rozpoznaje pliki po rozszerzeniu i grupuje je wg prostych, przewidywalnych
reguł (zgodnych z konwencją Audiobookshelf/Plex):

```
library/
├── J.R.R. Tolkien/
│   ├── the_hobbit.epub          ← e-book = jedna pozycja
│   └── the_hobbit.mobi          ← ten sam tytuł → dołączony jako drugi format
└── Frank Herbert/
    └── Dune/                     ← FOLDER = jeden audiobook
        ├── 01 - Rozdział 1.mp3   ← każdy plik = rozdział (wg numeru ścieżki)
        ├── 02 - Rozdział 2.mp3
        └── cover.jpg             ← opcjonalna okładka (lub folder.jpg)
```

- **E-booki**: grupowane wg *folderu + nazwy pliku* (bez rozszerzenia). Pliki
  o tej samej nazwie w różnych formatach = jedna pozycja z wieloma formatami.
- **Audiobooki**: **wszystkie pliki audio w jednym folderze = jeden audiobook**.
  Kolejność wg tagu numeru ścieżki, a w razie jego braku — naturalnie wg nazwy.
- Pojedynczy plik `.m4b` z osadzonymi rozdziałami działa od razu.
- Okładka: osadzona w pliku, a w razie braku `cover.jpg`/`folder.jpg` w folderze.

---

## 🔄 Migracja z Calibre

Masz już bibliotekę w Calibre? Zaimportuj jej metadane i okładki (pliki zostają
w miejscu — nic nie jest kopiowane ani przenoszone):

```bash
# CLI:
npm run import-calibre -- "/ścieżka/do/Calibre Library"
```

lub w interfejsie: **Ustawienia → Import z Calibre** → wklej ścieżkę do katalogu
z `metadata.db` → **Importuj**.

Przenoszone są: tytuł, autorzy, seria + numer, wydawca, rok, język, ISBN/ASIN,
opis, tagi, ocena (skala Calibre 0–10 → 0–5) oraz okładki. Import jest
**idempotentny** — ponowne uruchomienie aktualizuje istniejące pozycje zamiast
tworzyć duplikaty. Rutynowy skan biblioteki **nie usuwa** pozycji zaimportowanych
z Calibre (plików spoza `LIBRARY_DIR`).

## ⚙️ Konfiguracja (`.env`)

| Zmienna           | Domyślnie      | Opis |
|-------------------|----------------|------|
| `PORT`            | `4321`         | Port serwera HTTP |
| `LIBRARY_DIR`     | `./library`    | Folder z plikami (tylko odczyt) |
| `DATA_DIR`        | `./data`       | Baza danych i okładki |
| `PUBLIC_BASE_URL` | *(auto)*       | Bazowy URL dla linków OPDS |
| `AUTH_TOKEN`      | *(brak)*       | Token dostępu; puste = otwarte (OK dla localhost) |
| `SCAN_ON_START`   | `true`         | Przyrostowy skan przy starcie serwera |
| `LOG_LEVEL`       | `info`         | `debug` \| `info` \| `warn` \| `error` |
| `NODE_IMAGE`      | `node:22-alpine` | (tylko Docker) obraz bazowy — do podmiany na lustro |

---

## 🏗️ Architektura

Monorepo (npm workspaces):

```
Bibliotekarz/
├── server/           # Backend — Node.js + TypeScript + Express
│   └── src/
│       ├── db.ts         # node:sqlite (WAL, FTS5) — bez natywnej kompilacji
│       ├── repo.ts       # warstwa dostępu do danych
│       ├── scanner.ts    # skan + grupowanie + wykrywanie zmian
│       ├── formats/      # parsery: epub, pdf, audio (rozdziały m4b), zip
│       ├── http.ts       # REST API, streaming Range, czytnik, OPDS
│       └── opds.ts       # katalog OPDS 1.2
└── web/              # Frontend — React + Vite + TypeScript
    └── src/
        ├── player/       # globalny odtwarzacz audiobooków (rozdziały, prędkość, timer)
        ├── pages/        # biblioteka, szczegóły, czytnik, kolekcje, ustawienia
        └── components/   # karty, okładki, modale, hooki
```

**Stos technologiczny:** Node.js 22, TypeScript, Express 5, wbudowane
`node:sqlite` (SQLite + FTS5), `music-metadata` (tagi audio + rozdziały),
`fflate` (EPUB/ZIP), `fast-xml-parser` (OPF/NCX/OPDS), React 18, React Router,
Vite.

---

## 🔌 REST API (skrót)

| Metoda | Ścieżka | Opis |
|--------|---------|------|
| `GET`  | `/api/stats` | Statystyki biblioteki |
| `GET`  | `/api/items` | Lista z filtrami (`kind`, `search`, `author`, `series`, `tag`, `collection`, `status`, `sort`, `order`, `limit`, `offset`) |
| `GET`  | `/api/items/:id` | Szczegóły pozycji (pliki, rozdziały, postęp) |
| `PATCH`| `/api/items/:id` | Edycja metadanych |
| `DELETE`| `/api/items/:id` | Usunięcie z katalogu (plik zostaje) |
| `GET`  | `/api/items/:id/cover` | Okładka |
| `GET`  | `/api/items/:id/stream?fileId=` | Streaming (HTTP Range) |
| `GET`  | `/api/items/:id/download?fileId=` | Pobieranie |
| `GET`  | `/api/items/:id/manifest` | Spine + spis treści EPUB (czytnik) |
| `GET`  | `/api/items/:id/resource?href=` | Zasób z wnętrza EPUB |
| `GET`/`PUT` | `/api/items/:id/progress` | Odczyt/zapis postępu |
| `GET`  | `/api/authors` \| `/api/series` \| `/api/tags` | Fasety |
| `GET`/`POST`/`DELETE` | `/api/collections` … | Kolekcje |
| `POST` | `/api/scan` + `GET /api/scan/status` | Skan (asynchroniczny) |
| `POST` | `/api/import/calibre` | Import biblioteki Calibre (`{ path }`) |
| `GET`  | `/healthz` | Sonda żywotności (bez autoryzacji) |
| `GET`  | `/opds`, `/opds/ebooks`, `/opds/audiobooks`, `/opds/recent` | Katalog OPDS |

---

## 🧪 Testy

```bash
npm test        # testy jednostkowe parserów i narzędzi (node --test)
```

---

## 📜 Licencja

MIT — używaj, modyfikuj i hostuj bez ograniczeń.
