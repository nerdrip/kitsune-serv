# Audyt wydania KitsuneServ 3.0.0

Data kontroli: 2026-08-09. Zakres: aplikacja Electron, tryb web/server, Kitsune Hub, uwierzytelnianie i synchronizacja, Test Lab/API Flow, rozszerzenie Plesk, bezpieczeństwo danych oraz paczki Windows x64, Linux x64 i uniwersalnego serwera.

## Wynik

Wydanie 3.0.0 przeszło lokalny gate, pełny build oraz smoke-testy Windows i Linux. Osiem paczek znajduje się w `artifacts/`, ich zawartość odpowiada wersji 3.0.0, a wszystkie sumy z manifestu i `SHA256SUMS.txt` zostały ponownie obliczone oraz porównane z plikami.

| Kontrola | Wynik |
|---|---|
| testy Node.js na Windows | 126/126 |
| testy Node.js w builderze Linux | 124 OK, 1 pominięty wyłącznie z powodu braku PHP w obrazie |
| PHP lint rozszerzenia Plesk na Windows | OK |
| kontrola składni, odwołań DOM i duplikatów ID | OK; 471 odwołań DOM, 1000 unikalnych ID |
| pełny `npm audit` | 0 podatności produkcyjnych i deweloperskich |
| packaged Electron smoke-test Windows | OK |
| packaged Electron smoke-test Linux pod Xvfb | OK |
| QA Chromium 1360×860 | OK; brak poziomego przepełnienia |
| CycloneDX 1.5 SBOM | 320 komponentów |
| manifest i `SHA256SUMS.txt` | 8 paczek, 10 kontrolowanych plików, 0 rozbieżności |

## Sprawdzone podsystemy

- Automatyczna synchronizacja domen zarządza tylko oznaczonym blokiem systemowego pliku `hosts`, zachowuje wpisy użytkownika i usuwa wyłącznie nieaktualne domeny KitsuneServ.
- Detekcja i uruchamianie istniejących projektów nie tworzy `index.html` ani `index.htm` w ich katalogach. Otwieranie VS Code na Windows preferuje `Code.exe`, poprawnie obsługuje shim `code.cmd` i zwraca kontrolowany błąd zamiast wywracać aplikację.
- Dashboard projektów, preflight, profile środowiskowe, szyfrowane sekrety, lifecycle hooks, kolejność zależności i odzyskiwanie po nieczystym zamknięciu działają w desktopie oraz trybie webowym.
- Workbench baz danych obsługuje PostgreSQL, MySQL, MariaDB i MongoDB, nawigację obiektów, stronicowanie, zapisane zapytania, historię, transakcje, EXPLAIN, limity czasu, anulowanie oraz domyślny tryb read-only.
- Test Lab uruchamia niezależne sidecary Node/PHP/Python/Go/Bun/Deno, buduje wizualne plany środowisk i tworzy izolowane laboratorium WordPress z live-mountem pluginów. Usunięcie laboratorium nie usuwa źródeł pluginu.
- Visual REST API Flow Builder wykonuje 31 typów bloków, wiele tras w jednym projekcie, gałęzie normalne/true/false/cache/error, zapytania bazowe i sieciowe, transformacje, limity, cache oraz bezpieczne sekrety. Zintegrowany klient wysyła prawdziwe żądania do aktywnego listenera i pokazuje wynik oraz trace każdego bloku.
- Pasek API pokazuje stany starting/running/stopping/error, URL, uptime, liczniki żądań i błędów oraz ostatni wynik HTTP. Layout Test Lab został sprawdzony w rozdzielczości ze zgłoszenia; palety, płótno i inspektor nie nachodzą na siebie.
- Kitsune Hub ma trwałe konta, role owner/admin/operator/developer/auditor/viewer, członkostwa zakresowe, scrypt, szyfrowane TOTP, jednorazowe recovery codes, zaproszenia, trwałe sesje i odwoływalne tokeny API/device/agent/Plesk z ograniczonymi uprawnieniami.
- Gateway obsługuje płaskie subdomeny pod jedną domeną panelu, HTTP i WebSocket, polityki public/session/bearer, walidację targetów i separację kanałów aktualizacji desktop/server/Plesk.
- Parowanie urządzeń używa krótkotrwałych kodów, heartbeatów i odwoływalnych tokenów. Synchronizacja projektów, laboratoriów, API Flow, środowisk, snapshotów, profili wdrożeń i polityk jest wersjonowana, redaguje sekrety, wykrywa konflikty, zachowuje historię, rollback oraz tombstones.
- Synchronizacja dwóch Hubów jest idempotentna, śledzi rewizje, nie nadpisuje rozbieżnych zmian i opcjonalnie przypina certyfikat TLS po SHA-256. Workflow wdrożeń obsługuje approval, replace, blue-green, canary, preview, health i rollback states.
- Plesk Bridge release 10 ma wersjonowany executor uprzywilejowany weryfikowany podczas instalacji przez oficjalny `pm_ApiCli::callSbin` self-check, więc proces `post-install` nie próbuje czytać chronionego pliku i Plesk nie może ponownie uruchomić pozostawionej kopii `sbin` z wcześniejszego wydania. Zarządzana publikacja odczytuje faktyczny nginx Proxy Mode przez `--show-web-server-settings`, aktualizuje go udokumentowanym narzędziem `subscription`, zapamiętuje jego poprzedni stan i przy błędzie przywraca zarówno ustawienie domeny, jak i plik dyrektyw. Wygenerowany `location /` nie jest już błędnie utożsamiany z włączonym Proxy Mode. Rozszerzenie ma poprawny entry point zarządzany przez Plesk SDK, wymuszone zakończenia linii Unix LF niezależnie od platformy buildera, minimalną wersję Plesk 18.0.41, wybór aktywnej domeny z inventory Pleska, automatyczny/ręczny URL i reverse proxy, tryb zarządzanego lub zewnętrznego Huba, szyfrowane ustawienia, parowanie, heartbeat, redagowany inventory domen, service-plan permission i wpisy menu dla Service Provider/Reseller/Power User. Automatycznie wykrywa zgodny Node.js ≥22.19 z instalacji Pleska lub systemu, dobiera npm i naprawia starszą jednostkę systemd przy starcie. Brakujące ID konektora, sekret i adres Pleska generują się przy zapisie lub wdrożeniu, a start/restart bezpiecznie odświeża zmienne uwierzytelniania bez pełnego redeployu.
- Tryb hybrydowy sprawdza hasło w Plesku przed hasłem lokalnym. Podpisany, jednorazowy protokół do publicznego endpointu Pleska ma 60-sekundowe okno, ochronę nonce/replay, limit rozmiaru oraz ścisły HTTPS; hasło nie jest zapisywane ani logowane. Zbieżna nazwa użytkownika łączy tożsamość Pleska z istniejącym lokalnym profilem, zachowując jego ID, role, MFA i lokalne hasło.
- Zarządzane wdrożenie Plesk obsługuje Git HTTPS przez tymczasowy `GIT_ASKPASS`, SSH ze ścisłym `known_hosts`, rozdzielone katalogi kodu/wydania/danych, staging, rollback kodu oraz konfiguracji systemd, zarządzany oznaczony blok nginx, kontrolę zdrowia i logi. Automatycznie przekazuje domenę, tryb kont i konektor Pleska do uruchamianego Huba.
- Sekrety projektów, połączeń, laboratoriów, integracji i Hubów nie trafiają do zwykłych plików konfiguracyjnych. Logi, ślady, synchronizacja i raport wsparcia redagują tokeny, hasła, nagłówki authorization i lokalne ścieżki.
- Dziennik audytowy tworzy łańcuch SHA-256 i wykrywa zmianę historycznego wpisu. Aktualizacje wymagają zgodnej sumy SHA-256 oraz podpisu manifestu Ed25519.

## Artefakty 3.0.0

| Plik | Rozmiar | SHA-256 |
|---|---:|---|
| `artifacts/windows/KitsuneServ-3.0.0-x64-setup.exe` | 108 743 498 B | `f111e9c70ef4b7bb5c5699e4996ad679ede66e647a53ea345a21f340b970459a` |
| `artifacts/windows/KitsuneServ-3.0.0-x64-portable.exe` | 108 430 327 B | `d2b20fc45e505fa089b54010d3b5110a8dd8e03b72cd7a1c716be91f9938917a` |
| `artifacts/linux/KitsuneServ-3.0.0-x86_64.AppImage` | 94 165 359 B | `24fcec7e3bb5b6b9e2eaac2519b423fa56a89f407e8f3fe74d6e2236a19c3035` |
| `artifacts/linux/KitsuneServ-3.0.0-amd64.deb` | 95 616 104 B | `214740351017871848cbd07aaf517f29561f525c56f31cafaf517ea565d2631d` |
| `artifacts/linux/KitsuneServ-3.0.0-x86_64.rpm` | 84 118 189 B | `278ef99aefeadf053533b341838a00a2372ef272699cd15a4cd53cfe7e2e17eb` |
| `artifacts/plesk/kitsuneserv-bridge-3.0.0-r10.zip` | 609 305 B | `61c0332468b95f8b8513b7fede0c42250e1adc33ceb85349b92d653be2ee5ae1` |

Pakiety serwerowe ZIP/TAR zawierają ten raport, dlatego ich końcowe rozmiary i sumy są zapisywane po spakowaniu wyłącznie w zewnętrznych `artifacts/release-manifest.json` i `artifacts/SHA256SUMS.txt`. Pozwala to uniknąć samoodwołującej się sumy pliku znajdującego się we własnym archiwum. Te dwa pliki oraz `artifacts/SBOM.cdx.json` stanowią kanoniczny indeks wydania.

## Granice formalne i zewnętrzne

- Instalator i portable mają obecnie status Authenticode `NotSigned`, ponieważ nie dostarczono formalnego certyfikatu code-signing. Integracja waliduje certyfikat i `signtool`; po skonfigurowaniu builder podpisze paczki bez zmiany kodu aplikacji. Do tego czasu Windows może pokazać SmartScreen.
- Manifest ma celowo `signed: false`, ponieważ nie ustawiono prywatnego klucza Ed25519 ani publicznego bazowego URL-a wydania. Produkcyjny kanał aktualizacji należy publikować dopiero z `KITSUNE_UPDATE_PRIVATE_KEY` i `KITSUNE_RELEASE_BASE_URL`; updater nie zaakceptuje niepodpisanej aktualizacji.
- Rozszerzenie Plesk przeszło test struktury, PHP lint, testy zarządzanego wdrożenia i testy protokołu, ale końcowa instalacja integracyjna wymaga zewnętrznego serwera Plesk 18.0.41+, domeny oraz zaufanego certyfikatu. Wildcard DNS/certyfikat jest potrzebny tylko dla automatycznych subdomen zasobów Huba; dostawca DNS i certyfikatu pozostają jawnie konfigurowalni.
- GitHub/GitLab, winget/Chocolatey/Scoop, OAuth/OIDC, Sentry, OpenTelemetry/Grafana, sejfy sekretów, tunele i zdalne agenty mają gotowe konfiguracje, przechowywanie sekretów oraz testy gotowości. Publikowanie lub pełne testy dostawców wymagają ich rzeczywistych kont, zgód, callbacków, certyfikatów i praw do repozytoriów.
- Automaty WordPress mają testy montowania, konfiguracji i ochrony źródeł. Pełny test świeżej instalacji z realną bazą wymaga wybranego stosu PHP + Apache/Nginx + MySQL/MariaDB na maszynie docelowej.
