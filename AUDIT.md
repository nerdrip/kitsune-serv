# Audyt KitsuneServ 1.0.0-beta13

Data audytu: 29 lipca 2026. Zakres obejmował architekturę Electron i tryb webowy, IPC/REST, zarządzanie procesami, plikami i bazami, pobieranie archiwów, App Store, interfejs, zależności, testy oraz pakowanie Windows x64.

## Najważniejszy wynik

Aplikacja została doprowadzona do stanu używalnego jako instalowany menedżer lokalnego środowiska. Naprawiono krytyczne błędy App Store, ścieżek i logowania w wydaniu spakowanym, oddzielono dane użytkownika od katalogu programu, dodano kompletny Version Manager dla 16 usług oraz zrównano wspólny interfejs desktop/web. Beta13 dodaje menedżer kompletnych projektów i stosów, szyfrowany sejf połączeń, kopie baz, domeny i lokalny HTTPS, CLI, cache offline, pluginy deklaratywne, WSL/systemd, bezpieczne tunele oraz podpisany kanał aktualizacji. Wydanie zawiera instalator i portable Windows, AppImage/DEB/RPM Linux oraz uniwersalny serwer webowy.

## Zakres wydania beta13

- centrum projektów z gotowymi stosami PHP, Laravel, Symfony, WordPress, Node, Next.js, Vite, Django, FastAPI, MongoDB i stron statycznych;
- start/stop zależności, współdzielenie procesów i rollback wersji; dwa projekty nie mogą po cichu nadpisać sobie tego samego serwera WWW;
- przywracanie wcześniejszego katalogu, domeny i TLS profilu WWW po zakończeniu projektu;
- Activity Center z trwałym postępem, historią, błędami i anulowaniem operacji oraz Kitsune Doctor sprawdzający zgodność, porty, katalogi i PATH;
- zarządzany blok domen w pliku hosts, lokalne certyfikaty mkcert i kontrola ich ważności;
- szyfrowany sejf połączeń, natywne kopie/restore PostgreSQL, MySQL, MariaDB i MongoDB, SHA-256, rotacja oraz wykonywany automatycznie harmonogram;
- MongoDB backup/restore używa prywatnego pliku `--config` 0600, więc hasło nie trafia do listy procesów;
- eksport/import środowiska i snapshoty bez sekretów, rollback konfiguracji oraz bezpieczna relokacja obcych katalogów;
- zweryfikowany cache offline instalatorów z eksportem/importem oraz CLI `kitsune` do projektów, usług, wersji, PATH, domen, portów i cache;
- integralne pluginy deklaratywne bez wykonywania kodu, transakcyjna aktualizacja pluginu, wykrywanie toolchainów i otwieranie IDE;
- nazwane komendy projektu uruchamiane na hoście lub w wybranej dystrybucji WSL; na Linuxie usługa użytkownika systemd z trwałymi poświadczeniami 0600;
- tymczasowe udostępnianie projektu przez wykryty `cloudflared` lub `ngrok`, zawsze kończone wraz z aplikacją;
- TOTP, bearer token, allowlista IP i zarządzanie sesjami w trybie webowym;
- aktualizacje wymagające podpisu Ed25519 manifestu oraz zgodnej sumy SHA-256 paczki;
- zredagowany raport wsparcia, CycloneDX SBOM, podpisywany manifest paczek i zbiorczy SHA256SUMS.

## Naprawione problemy

### Bezpieczeństwo

- zablokowano wyjście poza katalogi usług, projektów i instancji przez `..`, ścieżki absolutne i kolizje prefiksów;
- ograniczono identyfikatory usług, typy projektów, nazwy projektów/baz oraz klucze zmiennych środowiskowych;
- pobieranie runtime'ów akceptuje HTTPS, maksymalnie 5 przekierowań i 5 GB danych;
- zaufane certyfikaty systemu są dołączane do magazynu Node.js, co wspiera komputery z firmowym proxy lub inspekcją HTTPS antywirusa;
- archiwa są listowane i sprawdzane pod kątem niebezpiecznych ścieżek przed rozpakowaniem;
- oficjalne sumy SHA-256 są weryfikowane dla Node.js, Python, PHP, Go oraz wydań GitHub, które je publikują;
- instalator Composera jest sprawdzany podpisem SHA-384 przed uruchomieniem;
- hasła MySQL/MariaDB nie są przekazywane w argumentach procesu, a nowe profile MinIO otrzymują losowe hasło;
- Electron działa z `contextIsolation`, sandboxem, bez Node.js w rendererze, blokadą nawigacji i filtrem zewnętrznych URL;
- dodano blokadę drugiej instancji aplikacji oraz limity wejścia terminala;
- tryb webowy domyślnie nasłuchuje tylko na `127.0.0.1`, ma limit prób logowania, kontrolę Origin, wymagany JSON i zaostrzone nagłówki;
- tryb webowy obsługuje opcjonalny natywny TLS, bezpieczne ciasteczko HTTPS, HSTS, poprawne kody 400/404/413/415 i kontrolowane błędy asynchroniczne;
- terminale webowe oraz ich SSE są przypisane do sesji, walidują rozmiar wejścia i są zamykane przy wylogowaniu lub wygaśnięciu sesji;
- zapis konfiguracji jest atomowy, ma kopię zapasową i odzyskiwanie po uszkodzeniu.

### Funkcjonalność

- naprawiono nieistniejące metody, sygnatury i statusy w App Store;
- naprawiono lokalizację zasobów po spakowaniu aplikacji;
- dane zmienne przeniesiono do `%APPDATA%\KitsuneServ` z opcją `KITSUNE_DATA_DIR`;
- dodano listę 16 usług, filtrowanie, instalację, usuwanie i przełączanie wersji;
- synchronizacja na żywo obsługuje 11 dostawców; w teście zwróciła bez błędów m.in. 573 wersje Node.js, 55 Python i 356 Go;
- Node.js rekomenduje LTS, a Nginx gałąź stable;
- poprawiono automatyczny start profili (nie jest już błędnie zależny od opcji startu Windows);
- poprawiono kategorie Python/Deno w menu oraz usunięto kontrolki sugerujące niezaimplementowaną lokalizację/auto-update;
- poprawiono zatrzymywanie procesów, timeouty, wykrywanie natychmiastowego zakończenia i bezpieczne zamykanie drzew procesów;
- przebudowano zarządzanie Windows `PATH`: wybór dowolnych usług, dodawanie/usuwanie wszystkich lub pojedynczych pozycji, zachowanie obcych katalogów i bezpieczny zapis bez interpolowania danych w poleceniu PowerShell;
- zmiana aktywnej wersji/profilu oraz zakończona instalacja synchronizują wybrane wpisy natychmiast, a start aplikacji sam naprawia wpisy nieaktualne;
- dodano rozgłaszanie `WM_SETTINGCHANGE`, migrację wpisów ze starszych wersji oraz poprawne katalogi `Apache24\bin` i `pgsql\bin`;
- terminal wbudowany otrzymuje wszystkie aktywne zainstalowane binaria niezależnie od selekcji globalnego `PATH`;
- dodano integrację z oficjalnym Python Install Managerem: automatyczną instalację z manifestu `python.org` dopiero przy instalowaniu pierwszego Pythona, ręczne ponowienie z interfejsu, rejestrację runtime'ów przez PEP 514 oraz automatyczne podążanie domyślnego `py` za aktywną wersją;
- usunięcie ostatniego zarządzanego Pythona czyści rejestracje i usuwa manager, jeśli został zainstalowany przez KitsuneServ; manager zastany wcześniej w systemie pozostaje nietknięty;
- tryb pakietowego `--smoke-test` ma wyłączone operacje systemowe, więc izolowany test wydania nie zmienia użytkowego `PATH`, rejestracji PEP 514 ani stanu Python Managera;
- naprawiono uruchamianie samego `py` w awaryjnym launcherze, a po wykryciu oficjalnego managera własna zaślepka jest automatycznie usuwana; pozostaje tylko alias `python3` dla aktywnego runtime'u;
- wykrywane są specjalne reparse pointy `python.exe`/`python3.exe` tworzone przez Microsoft Store; interfejs wyjaśnia konflikt i prowadzi użytkownika do ustawień aliasów wykonywania aplikacji;
- usunięto niedziałający na części wersji Windows skrót do podstrony aliasów; przycisk używa oficjalnego URI strony Aplikacje, kopiuje polską frazę wyszukiwania i pokazuje dokładną ścieżkę nawigacji;
- dodano transakcyjne przełączanie wersji i profili działających usług wraz z automatycznym restartem zależności oraz rollbackiem;
- uruchomienie Apache/Nginx/Caddy jest przerywane, jeśli wymagany PHP-CGI nie może wystartować;
- poprawiono obsługę dodatkowego katalogu `Apache24`, konfigurację FastCGI na Windows i generowanie `php.ini` dla różnych zestawów DLL;
- zatrzymywanie serwera WWW czeka teraz na zakończenie osieroconego PHP, co usuwa wyścig podczas restartu;
- zablokowano usunięcie wersji używanej przez dowolny profil.
- przebudowano Version Manager: widoczne są wszystkie zainstalowane wydania, powiązania z profilami, akcje per wersja, czyszczenie nieużywanych plików oraz postęp pobierania, weryfikacji i instalacji;
- instalowanie oraz usuwanie binariów jest dostępne wyłącznie w Version Managerze; panele usług i modal profilu pokazują tylko wersje już zainstalowane, a używana wersja pozostaje chroniona przed usunięciem;
- log viewer łączy `stdout`/`stderr` z przyrostowym śledzeniem plików Apache, Nginx, Caddy, PHP, PostgreSQL i MongoDB, obsługuje skrócenie/rotację pliku i rzeczywiście czyści bufor backendu;
- dodano przyciski otwierania aktywnego Apache, Nginx lub Caddy pod właściwym lokalnym adresem w domyślnej przeglądarce;
- zamknięcie aplikacji czeka na zatrzymanie wszystkich usług, a po timeoutach na zakończenie wymuszonego zamknięcia całego drzewa procesu;
- folder WWW wybiera się natywnym pickerem; zapis natychmiast regeneruje konfigurację i restartuje właściwy serwer;
- dodano wymuszany globalny katalog WWW dla Apache/Nginx/Caddy z blokadą ustawień per profil, restartem wszystkich aktywnych serwerów i rollbackiem;
- usunięto mnożenie liczników czasu działania w sidebarze;
- terminal ma stały obszar roboczy, własny scroll, tryb podążania za wyjściem, przycisk powrotu na dół i czyszczenie;
- dodano centralny Database Manager z natywnymi sterownikami PostgreSQL/MySQL/MariaDB/MongoDB, wykrywaniem portów zarządzanych/lokalnych, własnymi połączeniami, testem, listą baz i tabel, konsolą zapytań oraz tworzeniem/usuwaniem baz; hasła są tylko sesyjne.
- webowy adapter ma teraz brakujące zdarzenie Python Managera, rzeczywisty import/eksport plików oraz picker katalogów serwera zamiast pola `prompt`;
- etykiety i zachowanie PATH reagują na platformę: Windows modyfikuje użytkowy PATH, a Linux zarządzany blok profilu powłoki;
- serwer webowy przechowuje dane w `%APPDATA%\kitsuneserv` na Windowsie, `${XDG_CONFIG_HOME:-~/.config}/kitsuneserv` na Linuxie lub `KITSUNE_DATA_DIR`, dzięki czemu kod może być tylko do odczytu;

### Wydanie i jakość

- Electron zaktualizowano do 41.10.3, środowisko budowania do Node.js 22.19+ (zalecane 24 LTS), mysql2 do 3.23.2, a electron-builder do 26.15.7;
- zastąpiono skrypt budujący, który modyfikował `node_modules` i ignorował błędy;
- dodano kontrolę składni, duplikatów ID i odwołań DOM;
- dodano 70 testów jednostkowych/integracyjnych konfiguracji, ścieżek, projektów, kopii i sekretów, selektywnego PATH, trybu kontenerowego, oficjalnego i awaryjnego launchera Python, rozpakowywania PostgreSQL, współpracy stosu WWW, webowego logowania/API, domen, pluginów, tuneli, aktualizacji, katalogów danych, logów, zamykania usług i natywnych połączeń baz;
- wykonano test realnego pobrania, sumy kontrolnej, rozpakowania i uruchomienia Python 3.14.3;
- naprawiono końcowe spłaszczanie archiwów PostgreSQL na Windows: operacje `rename` mają retry i bezpieczny fallback copy/remove, błędy ekstraktora wracają jako wynik instalacji zamiast kończyć proces Electron, a przerwane instalacje są oznaczane i czyszczone przed ponowieniem;
- pełne archiwum PostgreSQL 18.4 (337 MB) rozpakowano po poprawce, sprawdzono układ `bin`/`doc` i uruchomiono `postgres --version`;
- wygenerowano wielorozmiarową ikonę ICO oraz artefakty NSIS i portable.
- uporządkowano wydania w `artifacts/windows`, `artifacts/linux` i `artifacts/server`; dodano osobne BAT-y oraz `build-all.bat`, Dockerfile, Compose i izolowany builder Linux ze smoke-testem GUI.

## Wyniki weryfikacji

| Kontrola | Wynik |
|---|---|
| `npm run check` | OK; 197 odwołań DOM, 710 unikalnych ID |
| `npm test` | 70/70 zaliczone natywnie na Windows oraz 70/70 w izolowanym środowisku Linux |
| integracja web | logowanie, sesja, REST, kody błędów, picker katalogów i zgodność adaptera sprawdzone procesem potomnym |
| kontener Linux | obraz Debian/Node 24 zbudowany; logowanie 302 i `app/getInfo` zwraca `platform=linux`, `dataRoot=/data` |
| logi Nginx | potwierdzono realne `access.log` i `error.log` w katalogu zarządzanej wersji oraz test przyrostu, rotacji i czyszczenia |
| selektywny Windows `PATH` | testy: all/selected, remove all/selected, migracja, oczekująca instalacja, zamiana wersji i `Apache24\bin` |
| Python Manager | oficjalny manager 26.3 widzi `KitsuneServ/3.14.3`; samo `py`, `py --version`, `py --list`, `py -3.14` i `py -V:KitsuneServ/3.14.3` uruchamiają zarządzany Python 3.14.3 |
| Nginx + PHP | prawdziwa odpowiedź PHP 8.4.20 oraz przełączenie działającego stosu 8.4.20 → 8.5.9 |
| Apache + PHP | prawdziwa odpowiedź PHP przez Apache 2.4.66 i `mod_proxy_fcgi` |
| `npm run test:download-smoke` | Python 3.14.3 pobrany, zweryfikowany i uruchomiony |
| synchronizacja katalogów | 11/11 źródeł bez błędów |
| domyślne archiwa Windows | 16/16 adresów odpowiedziało HTTP 200 |
| `npm audit --omit=dev` | 0 podatności produkcyjnych |
| `npm run dist:win` | finalny instalator NSIS i portable beta13 zbudowane poprawnie po wszystkich kontrolach |
| Linux desktop | AppImage, DEB i RPM beta13 zbudowane w izolowanym kontenerze; AppImage uruchomiony poprawnie pod Xvfb |
| inspekcja `app.asar` | potwierdzono obecność modułów aktualizacji, serwera web, projektów, platform, kopii i raportów wsparcia; zewnętrzny wrapper CLI również jest w paczce |
| smoke-test `win-unpacked` | kod 0 w rzeczywistym trybie Electron na oddzielnym katalogu danych |
| portable EXE | kod smoke-testu 0 |
| instalator NSIS | artefakt beta13 zbudowany poprawnie; suma SHA-256 zgodna |
| manifest wydania | 7 paczek, wszystkie rozmiary i skróty SHA-256 zgodne |
| SBOM | poprawny CycloneDX 1.5, 320 komponentów |

## Świadome ograniczenia i dalsze rekomendacje

- Artefakty nie mają komercyjnego podpisu Authenticode. Do publicznej dystrybucji warto kupić certyfikat code-signing i podpisać EXE, aby ograniczyć ostrzeżenia SmartScreen.
- `npm audit --omit=dev` ma wynik 0. Audyt całego środowiska pokazuje 16 ostrzeżeń high w narzędziach budujących (`@electron/asar`, `electron-winstaller`, stare gałęzie `minimatch`); nie wchodzą one do grafu produkcyjnego. Wymuszenie automatycznie proponowanej starszej głównej wersji buildera nie jest bezpieczną poprawką, dlatego ryzyko pozostaje odizolowane w kontrolowanym procesie CI/build.
- Pełne testy uruchomieniowe wszystkich wersji wszystkich baz i serwerów wymagałyby wielu gigabajtów. Zweryfikowano Python, Nginx/PHP, Apache/PHP i pakiet Electron; przed szeroką publikacją warto dodać nocną macierz smoke-testów dla rekomendowanych wersji 16 usług.
- Katalogi Apache, PostgreSQL, MySQL, MongoDB i MinIO mają sprawdzony zestaw startowy, lecz nie wszystkie źródła udostępniają stabilny publiczny manifest. Kolejny etap może dodać podpisane, utrzymywane manifesty projektu.
- Nie każdy upstream publikuje przenośne archiwa Linux dla każdej usługi; UI filtruje brakujące wydania. Szczegóły są w `SERVICES.md`. macOS nie był przedmiotem tego audytu.
- Serwer domyślnie używa HTTP na localhost. Przy wystawieniu w sieci należy ustawić silne `KITSUNE_PASS` i użyć `KITSUNE_TLS_CERT`/`KITSUNE_TLS_KEY` albo reverse proxy z TLS oraz zapory.
- Wbudowany terminal z definicji wykonuje polecenia użytkownika. Należy go traktować jak lokalny terminal systemowy, nie udostępniać niezaufanym osobom.
