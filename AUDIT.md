# Audyt wydania KitsuneServ 3.0.0

Data kontroli: 2026-08-09. Zakres: aplikacja Electron, tryb web/server, Kitsune Hub, uwierzytelnianie i synchronizacja, Test Lab/API Flow, rozszerzenie Plesk, bezpieczeństwo danych oraz paczki Windows x64, Linux x64 i uniwersalnego serwera.

## Wynik

Wydanie 3.0.0 przeszło lokalny gate, pełny build oraz smoke-testy Windows i Linux. Osiem paczek znajduje się w `artifacts/`, ich zawartość odpowiada wersji 3.0.0, a wszystkie sumy z manifestu i `SHA256SUMS.txt` zostały ponownie obliczone oraz porównane z plikami.

| Kontrola | Wynik |
|---|---|
| testy Node.js na Windows | 123/123 |
| testy Node.js w builderze Linux | 122 OK, 1 pominięty wyłącznie z powodu braku PHP w obrazie |
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
- Plesk Bridge release 3 ma poprawny entry point zarządzany przez Plesk SDK, minimalną wersję Plesk 18.0.41, wybór aktywnej domeny z inventory Pleska, automatyczny/ręczny URL i reverse proxy, tryb zarządzanego lub zewnętrznego Huba, szyfrowane ustawienia, parowanie, heartbeat, redagowany inventory domen, service-plan permission i wpisy menu dla Service Provider/Reseller/Power User.
- Zarządzane wdrożenie Plesk obsługuje Git HTTPS przez tymczasowy `GIT_ASKPASS`, SSH ze ścisłym `known_hosts`, rozdzielone katalogi kodu/wydania/danych, staging, rollback kodu oraz konfiguracji systemd, zarządzany oznaczony blok nginx, kontrolę zdrowia i logi. Automatycznie przekazuje domenę, tryb kont i konektor Pleska do uruchamianego Huba.
- Sekrety projektów, połączeń, laboratoriów, integracji i Hubów nie trafiają do zwykłych plików konfiguracyjnych. Logi, ślady, synchronizacja i raport wsparcia redagują tokeny, hasła, nagłówki authorization i lokalne ścieżki.
- Dziennik audytowy tworzy łańcuch SHA-256 i wykrywa zmianę historycznego wpisu. Aktualizacje wymagają zgodnej sumy SHA-256 oraz podpisu manifestu Ed25519.

## Artefakty 3.0.0

| Plik | Rozmiar | SHA-256 |
|---|---:|---|
| `artifacts/windows/KitsuneServ-3.0.0-x64-setup.exe` | 108 741 857 B | `9d15abf5f0b248de9e6068033b299093e12deb51d42ef18ffc81cb9a83a7b702` |
| `artifacts/windows/KitsuneServ-3.0.0-x64-portable.exe` | 108 428 688 B | `6a2fdf88d2443dc2d9c430954370269ed16f9658dd38f68807b5f9d26cacc89c` |
| `artifacts/linux/KitsuneServ-3.0.0-x86_64.AppImage` | 94 161 111 B | `4868dca7a7b47c85d552e46f762947161194b0d79160a18c2ad40bd5a1eafcad` |
| `artifacts/linux/KitsuneServ-3.0.0-amd64.deb` | 95 614 052 B | `4b8fb9319c45999e048378299a8b4ec2eb7af8b28f1b9285b92c6c93ec51d401` |
| `artifacts/linux/KitsuneServ-3.0.0-x86_64.rpm` | 84 101 337 B | `057b71da3789e111914d9eb9a48cd53f83f6c7f26f6ede37c739c1651a13c618` |
| `artifacts/plesk/kitsuneserv-bridge-3.0.0-r3.zip` | 602 720 B | `56a1f37f7c6caf913fbc39734210826de0265a46eacad040c73276982a6b6849` |

Pakiety serwerowe ZIP/TAR zawierają ten raport, dlatego ich końcowe rozmiary i sumy są zapisywane po spakowaniu wyłącznie w zewnętrznych `artifacts/release-manifest.json` i `artifacts/SHA256SUMS.txt`. Pozwala to uniknąć samoodwołującej się sumy pliku znajdującego się we własnym archiwum. Te dwa pliki oraz `artifacts/SBOM.cdx.json` stanowią kanoniczny indeks wydania.

## Granice formalne i zewnętrzne

- Instalator i portable mają obecnie status Authenticode `NotSigned`, ponieważ nie dostarczono formalnego certyfikatu code-signing. Integracja waliduje certyfikat i `signtool`; po skonfigurowaniu builder podpisze paczki bez zmiany kodu aplikacji. Do tego czasu Windows może pokazać SmartScreen.
- Manifest ma celowo `signed: false`, ponieważ nie ustawiono prywatnego klucza Ed25519 ani publicznego bazowego URL-a wydania. Produkcyjny kanał aktualizacji należy publikować dopiero z `KITSUNE_UPDATE_PRIVATE_KEY` i `KITSUNE_RELEASE_BASE_URL`; updater nie zaakceptuje niepodpisanej aktualizacji.
- Rozszerzenie Plesk przeszło test struktury, PHP lint, testy zarządzanego wdrożenia i testy protokołu, ale końcowa instalacja integracyjna wymaga zewnętrznego serwera Plesk 18.0.41+, domeny oraz zaufanego certyfikatu. Wildcard DNS/certyfikat jest potrzebny tylko dla automatycznych subdomen zasobów Huba; dostawca DNS i certyfikatu pozostają jawnie konfigurowalni.
- GitHub/GitLab, winget/Chocolatey/Scoop, OAuth/OIDC, Sentry, OpenTelemetry/Grafana, sejfy sekretów, tunele i zdalne agenty mają gotowe konfiguracje, przechowywanie sekretów oraz testy gotowości. Publikowanie lub pełne testy dostawców wymagają ich rzeczywistych kont, zgód, callbacków, certyfikatów i praw do repozytoriów.
- Automaty WordPress mają testy montowania, konfiguracji i ochrony źródeł. Pełny test świeżej instalacji z realną bazą wymaga wybranego stosu PHP + Apache/Nginx + MySQL/MariaDB na maszynie docelowej.
