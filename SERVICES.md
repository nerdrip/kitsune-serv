# Usługi i wersje w KitsuneServ

KitsuneServ 3.1.2 zarządza 16 usługami oraz dwoma wersjonowanymi narzędziami deweloperskimi: Composerem i Eclipse Temurin JDK. Instalowanie i usuwanie wydań odbywa się wyłącznie w panelu **Version Manager**. Można tam wyszukać usługę albo konkretną wersję, zsynchronizować katalogi, zobaczyć wszystkie wydania na dysku, śledzić postęp instalacji, przełączyć aktywny profil i zbiorczo usunąć nieużywane wydania. Panele usług pozwalają wybierać tylko wersje już zainstalowane. Warstwa Kitsune Hub 3.1.2 synchronizuje definicje projektów, Test Labów i API Flow między sparowanymi węzłami, ale nie zmienia katalogu obsługiwanych runtime'ów.

## Pełna lista

| Kategoria | Usługa | Instalacja i przełączanie | Źródło katalogu |
|---|---|---|---|
| Serwer WWW | Apache HTTP Server | Tak, profile i wiele wersji | Wbudowane, sprawdzone archiwa Apache Lounge |
| Serwer WWW | Nginx | Tak; rekomendowana gałąź stable | Synchronizacja nginx.org |
| Serwer WWW | Caddy | Tak | Do 100 ostatnich wydań GitHub |
| Baza danych | PostgreSQL | Tak; osobny katalog danych profilu | Wbudowane binaria EDB |
| Baza danych | MySQL | Tak; inicjalizacja danych automatyczna | Wbudowane archiwa Oracle/MySQL |
| Baza danych | MariaDB | Tak; inicjalizacja danych automatyczna | Oficjalne API MariaDB z SHA-256 |
| Baza danych | MongoDB | Tak | Wbudowane archiwa MongoDB |
| Język | PHP | Tak; aktywne wydania x64 NTS | Oficjalny manifest PHP for Windows |
| Język | Node.js | Tak; pełny indeks x64, rekomendowane LTS | Oficjalny indeks Node.js i SHASUMS256 |
| Język | Go | Tak; pełny indeks archiwów amd64 | Oficjalne API go.dev z SHA-256 |
| Język | Bun | Tak | Do 100 ostatnich wydań GitHub i SHASUMS256 |
| Język | Python | Tak; pełny prywatny runtime Windows z pip | Oficjalny Python Install Manager i podpisany indeks python.org |
| Język | Deno | Tak | Do 100 ostatnich wydań GitHub i SHA-256 |
| Narzędzie | Composer | Tak; aktualna linia stabilna i 2.2 LTS | Oficjalny katalog getcomposer.org i SHA-256 |
| Narzędzie | Eclipse Temurin JDK | Tak; bieżące JDK oraz linie LTS | Oficjalne API Adoptium i SHA-256 |
| Cache | Redis | Tak; natywne wydania społecznościowe dla Windows | Do 100 wydań redis-windows |
| Cache | Memcached | Tak | Społecznościowe wydania jefyt/memcached-windows |
| Object storage | MinIO | Tak; kanał `latest` | Oficjalne binarium dl.min.io |

Katalog lokalny zapewnia wersje startowe także bez synchronizacji. Przycisk **Sync official catalogs** pobiera aktualną listę także dla Composera i Eclipse Temurin JDK. Katalog zachowuje starsze wersje wbudowane, więc można utrzymywać kilka projektów wymagających różnych środowisk.

## Typowy sposób użycia

1. Otwórz **Version Manager** i kliknij **Sync official catalogs**.
2. Wyszukaj usługę albo konkretną wersję i wybierz **Install**.
3. Po instalacji wybierz **Use in active profile**. Działająca usługa zostanie przełączona transakcyjnie: KitsuneServ zatrzyma jej zależności, uruchomi nową wersję i przywróci poprzednią konfigurację, jeśli start się nie powiedzie.
4. Wróć do panelu usługi, dostosuj port/projekt i uruchom ją.
5. Opcjonalnie wybierz konkretne narzędzia dla użytkowego `PATH` w ustawieniach ogólnych albo użyj **Add all**.

Przy działających Apache, Nginx i Caddy przycisk **Open site** otwiera poprawny lokalny adres w domyślnej przeglądarce. Zakładka **Logs** łączy wyjście procesu z przyrostowym odczytem plików `access.log` i `error.log`, dzięki czemu pokazuje również żądania obsługiwane poza `stdout`/`stderr`.

Pobrane pliki trafiają do `<data-root>\servers\<usługa>\<wersja>`. Projekty, bazy i konfiguracja są oddzielone od katalogu instalacyjnego, dlatego aktualizacja programu nie usuwa środowiska pracy.

Instalacje archiwów używają znacznika operacji w toku. Po przerwaniu procesu kolejna próba najpierw usuwa niekompletne pliki. Na Windows finalizacja ma ponawianie operacji oraz fallback copy/remove, dzięki czemu chwilowa blokada antywirusa lub indeksowania nie kończy procesu Electron.

## Selektywny PATH

- Każda z 16 usług oraz Composer i Java mają osobne pole wyboru; można dodawać i usuwać pojedyncze pozycje oraz użyć **Add all** / **Remove all**.
- Wybranie jeszcze niezainstalowanej usługi zapisuje ją jako oczekującą. Jej katalog pojawi się w `PATH` automatycznie po instalacji.
- Zmiana aktywnego profilu lub wersji usuwa katalog poprzedniej wersji i od razu wstawia katalog nowej, bez naruszania pozostałych wpisów użytkownika.
- Obsługiwane są również rzeczywiste układy archiwów, m.in. `Apache24\bin` i `pgsql\bin`.
- Zmiana jest zapisywana w użytkowym `PATH` Windows i rozgłaszana przez `WM_SETTINGCHANGE`; nowe terminale widzą ją bez restartu systemu.
- Na Linuxie wybór trafia do zarządzanego bloku w `.bashrc`/`.zshrc` (lub pliku z `KITSUNE_SHELL_RC`); obce wpisy pozostają nietknięte.
- Terminal wbudowany zawsze otrzymuje wszystkie zainstalowane aktywne binaria, niezależnie od wyboru dla globalnego `PATH`.
- Composer automatycznie dołącza aktywne PHP. Zarządzana Java ustawia również `JAVA_HOME`; po jej odłączeniu wcześniejsza systemowa wartość jest przywracana.
- Zarządzane wydania Python są rejestrowane w standardzie PEP 514. Oficjalny Python Install Manager widzi je jako środowiska `KitsuneServ/<wersja>`; `py`, `py --list`, `py -3.14` i `py -V:KitsuneServ/3.14.3` działają na nich bez ponownej instalacji Pythona.
- Instalacja pierwszego Pythona w **Version Managerze** automatycznie instaluje oficjalny Python Install Manager z `python.org`; bez instalowania Pythona system pozostaje niezmieniony. Usunięcie ostatniego Pythona usuwa również manager zainstalowany wcześniej przez KitsuneServ i czyści rejestracje PEP 514 (manager zastany wcześniej w systemie nie jest usuwany). Panel **General → PATH Management** pozwala ponowić instalację ręcznie. Bez sieci pozostaje działający launcher zgodności.
- Jeśli systemowe aliasy Microsoft Store przejmują komendy `python`/`python3`, aplikacja pokazuje ostrzeżenie, otwiera obsługiwaną stronę **Aplikacje**, kopiuje frazę `Aliasy wykonywania aplikacji` i podaje ścieżkę **Zaawansowane ustawienia aplikacji → Aliasy wykonywania aplikacji**. Po wyłączeniu `python.exe` i `python3.exe` należy otworzyć nowy terminal.

## Współpraca PHP z serwerami WWW

- Apache korzysta z `mod_proxy_fcgi`, Nginx z FastCGI, a Caddy z `php_fastcgi`.
- Uruchomienie serwera WWW automatycznie uruchamia aktywną wersję PHP. Błąd PHP zatrzymuje start stosu zamiast pozostawić serwer zwracający wyłącznie 502.
- Zmiana aktywnej wersji lub profilu PHP zatrzymuje działające Apache/Nginx/Caddy, przełącza PHP, a następnie uruchamia zależności w poprawnej kolejności.
- Nieudany start nowej wersji wykonuje rollback do poprzedniego PHP oraz ponownie uruchamia wcześniejszy stos.
- Zatrzymanie ostatniego serwera WWW kończy niepotrzebny proces PHP-CGI. Restart serwera czeka na pełne zatrzymanie PHP, dzięki czemu nie występuje wyścig na porcie FastCGI.
- Generator `php.ini` ładuje tylko biblioteki rozszerzeń istniejące w wybranym wydaniu. Rozszerzenia wbudowane w PHP nie są błędnie ładowane jako DLL.

Przepływ został sprawdzony na prawdziwych binariach Windows: Nginx 1.27.4 + PHP 8.4.20, przełączenie działającego stosu PHP 8.4.20 → 8.5.9 oraz Apache 2.4.66 + PHP 8.4.20.

## Zakres platform

Interfejs desktopowy jest budowany i uruchomieniowo sprawdzany jako Windows x64 oraz Linux x64 (AppImage, DEB i RPM). Tryb webowy jest testowany natywnie na Windowsie i w obrazie Debian/Linux; korzysta z tych samych managerów i renderera.

Dostępność konkretnych binariów zależy od platformy i publikacji upstreamu. Windows ma kompletne archiwa startowe usług i narzędzi. Linux ma przenośne wydania Node.js, PostgreSQL, MySQL, MariaDB, MongoDB, Go, Bun, Deno, Caddy, MinIO, Composer i Eclipse Temurin JDK. Apache, Nginx, PHP, Python, Redis i Memcached nie publikują w używanych kanałach równoważnych, samowystarczalnych archiwów Linux dla każdej wersji, dlatego Version Manager pokazuje tam tylko faktycznie dostępne wydania.
