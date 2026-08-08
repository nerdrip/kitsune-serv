# Audyt wydania KitsuneServ 3.0.0

Data kontroli: 2026-08-08. Zakres: aplikacja Electron, tryb web/server, Kitsune Hub, uwierzytelnianie i synchronizacja, Test Lab/API Flow, rozszerzenie Plesk, bezpieczeństwo danych oraz paczki Windows x64, Linux x64 i uniwersalnego serwera.

## Wynik

Wydanie 3.0.0 przeszło lokalny gate, pełny build oraz smoke-testy Windows i Linux. Osiem paczek znajduje się w `artifacts/`, ich zawartość odpowiada wersji 3.0.0, a wszystkie sumy z manifestu i `SHA256SUMS.txt` zostały ponownie obliczone oraz porównane z plikami.

| Kontrola | Wynik |
|---|---|
| testy Node.js na Windows | 121/121 |
| testy Node.js w builderze Linux | 120 OK, 1 pominięty wyłącznie z powodu braku PHP w obrazie |
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
- Plesk Bridge ma poprawną strukturę SDK, minimalną wersję Plesk 18.0.30, szyfrowane ustawienia, parowanie, heartbeat, redagowany inventory domen, service-plan permission, przyciski panelu i podpisane HMAC, jednorazowe SSO z mapowaniem ról oraz automatycznym provisionowaniem kont.
- Sekrety projektów, połączeń, laboratoriów, integracji i Hubów nie trafiają do zwykłych plików konfiguracyjnych. Logi, ślady, synchronizacja i raport wsparcia redagują tokeny, hasła, nagłówki authorization i lokalne ścieżki.
- Dziennik audytowy tworzy łańcuch SHA-256 i wykrywa zmianę historycznego wpisu. Aktualizacje wymagają zgodnej sumy SHA-256 oraz podpisu manifestu Ed25519.

## Artefakty 3.0.0

| Plik | Rozmiar | SHA-256 |
|---|---:|---|
| `artifacts/windows/KitsuneServ-3.0.0-x64-setup.exe` | 108 743 266 B | `5fc5990de3119c91857af573cd82b9af3e7d9973b10a0e479823848668e615d6` |
| `artifacts/windows/KitsuneServ-3.0.0-x64-portable.exe` | 108 430 097 B | `e777267b38e3f60d09789aa918408cfbaad20ebfd3c96ffe76bfb2c44cde5f5e` |
| `artifacts/linux/KitsuneServ-3.0.0-x86_64.AppImage` | 94 161 226 B | `3f05fdf47fac23146c6b703dad4fc9e0b057af54fd567c715ffa1f4b44b1a071` |
| `artifacts/linux/KitsuneServ-3.0.0-amd64.deb` | 95 615 292 B | `3cc048bcd21fb50b880c857696d89a09f3ba10e5a27389f68557eefcafe76d1e` |
| `artifacts/linux/KitsuneServ-3.0.0-x86_64.rpm` | 84 138 149 B | `5372cf24cb7bff1fff8c8435806f5ea5736abd8962df39c27365604996d64b57` |
| `artifacts/plesk/kitsuneserv-bridge-3.0.0.zip` | 573 479 B | `1f1d73991ef8e26e31e0f955ac40c61c112f9ea1fdca816c19e5f0200eeff75b` |

Pakiety serwerowe ZIP/TAR zawierają ten raport, dlatego ich końcowe rozmiary i sumy są zapisywane po spakowaniu wyłącznie w zewnętrznych `artifacts/release-manifest.json` i `artifacts/SHA256SUMS.txt`. Pozwala to uniknąć samoodwołującej się sumy pliku znajdującego się we własnym archiwum. Te dwa pliki oraz `artifacts/SBOM.cdx.json` stanowią kanoniczny indeks wydania.

## Granice formalne i zewnętrzne

- Instalator i portable mają obecnie status Authenticode `NotSigned`, ponieważ nie dostarczono formalnego certyfikatu code-signing. Integracja waliduje certyfikat i `signtool`; po skonfigurowaniu builder podpisze paczki bez zmiany kodu aplikacji. Do tego czasu Windows może pokazać SmartScreen.
- Manifest ma celowo `signed: false`, ponieważ nie ustawiono prywatnego klucza Ed25519 ani publicznego bazowego URL-a wydania. Produkcyjny kanał aktualizacji należy publikować dopiero z `KITSUNE_UPDATE_PRIVATE_KEY` i `KITSUNE_RELEASE_BASE_URL`; updater nie zaakceptuje niepodpisanej aktualizacji.
- Rozszerzenie Plesk przeszło test struktury, PHP lint i testy protokołu, ale instalacja w prawdziwym Plesk wymaga zewnętrznego serwera Plesk 18.0.30+, domeny, wildcard DNS oraz zaufanego certyfikatu. Certyfikat wildcard i dostawca DNS pozostają jawnie konfigurowalne.
- GitHub/GitLab, winget/Chocolatey/Scoop, OAuth/OIDC, Sentry, OpenTelemetry/Grafana, sejfy sekretów, tunele i zdalne agenty mają gotowe konfiguracje, przechowywanie sekretów oraz testy gotowości. Publikowanie lub pełne testy dostawców wymagają ich rzeczywistych kont, zgód, callbacków, certyfikatów i praw do repozytoriów.
- Automaty WordPress mają testy montowania, konfiguracji i ochrony źródeł. Pełny test świeżej instalacji z realną bazą wymaga wybranego stosu PHP + Apache/Nginx + MySQL/MariaDB na maszynie docelowej.
