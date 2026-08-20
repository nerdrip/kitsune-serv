# Kitsune Plesk Suite — zbiorcza aktualizacja

Folder zawiera paczki wszystkich managerów Pleska z ujednoliconą nawigacją i wyglądem. Skopiuj cały katalog `update` na serwer, np. do `/root/kitsune-plesk-update`, sprawdź sumy i uruchom jedną komendę:

```bash
bash /root/kitsune-plesk-update/install-all.sh
```

Równoważna jednolinijkowa komenda Pleska:

```bash
for package in /root/kitsune-plesk-update/packages/*.zip; do plesk bin extension -g "$package" || exit 1; done
```

Kolejność paczek jest zakodowana w prefiksach nazw. Kitsune Hub instaluje się jako ostatni, dzięki czemu po zakończeniu przejmuje centralną nawigację. `manifest.json` opisuje wersje i sumy SHA-256, a `SHA256SUMS` jest sprawdzany automatycznie przez instalator. Instalator akceptuje manifesty z końcami linii LF i CRLF.

Uwaga migracyjna: KitsuneColab i Kitsune Artifactory otrzymały unikalne identyfikatory `kitsunecolab-manager` oraz `kitsuneartifactory-manager`, ponieważ historyczne `kitsune-manager` było współdzielone. Paczki instalują nowe managery obok starego wpisu i celowo go nie nadpisują. Po potwierdzeniu poprawnej konfiguracji stary, jednoznacznie rozpoznany wpis można usunąć ręcznie.

Zestaw obejmuje także WPKit Parse Manager, Nerd Apps Runtime Manager i Ultimate Tool. Każdy zachowuje własne operacje wdrożeniowe, ale po wykryciu aktywnego Kitsune Hub oddaje mu wpis menu i pozostaje dostępny w **Plesk Management**.
