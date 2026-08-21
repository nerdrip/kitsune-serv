# Kitsune Plesk Suite extension template

Ten katalog jest punktem startowym dla kolejnych managerów Pleska. Zachowuje wspólny wygląd, nie dubluje wpisów nawigacji po wykryciu aktywnego Kitsune Hub i pozostawia produktowi własne operacje.

Przed użyciem:

1. Skopiuj katalog i zastąp `example-manager`, `ExampleManager` oraz `Example Product` unikalnymi wartościami.
2. Nie używaj ogólnego identyfikatora `kitsune-manager`. Identyfikator rozszerzenia, katalog modułu, prefiks klas i nazwa `sbin` muszą być unikalne.
3. Zachowaj hook `CustomButtons`: gdy `kitsuneserv-bridge` jest aktywny, konfiguracja będzie dostępna z zakładki **Kitsune Hub → Plesk Management**.
4. Własne funkcje podziel na przewidywalne sekcje: **Stan**, **Wdrożenie**, **Konfiguracja**, **Dane i backup**, **Diagnostyka**.
5. Oddziel wersję aplikacji od wersji rozszerzenia. Zmiany wyłącznie w paczce Pleska zwiększają `<release>`.
6. Pakuj zawartość katalogu rozszerzenia tak, aby `meta.xml` znajdował się w katalogu głównym ZIP.
7. Dodaj produkt do rejestru repozytoriów w `SuiteSelfUpdate.php` i
   `sbin/kitsune-suite-self-update`. Self-update nie korzysta z centralnego
   manifestu: synchronizuje gałąź repozytorium produktu, wykonuje wyłącznie
   fast-forward i pakuje katalog rozszerzenia z przypiętego commitu.

Pliki `htdocs/css/kitsune-platform.css` i `htdocs/js/kitsune-platform.js` są synchronizowane z kanonicznej wersji Bridge przez:

```powershell
./scripts/sync-plesk-suite-assets.ps1
```
