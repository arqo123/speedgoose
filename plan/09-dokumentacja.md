
## Faza 9: Dokumentacja Techniczna i Użytkownika

**Plik do edycji:** `README.md`

**Cel:** Stworzenie klarownej i kompletnej dokumentacji nowej funkcjonalności, aby użytkownicy mogli w pełni wykorzystać jej potencjał.

**Szczegółowe zadania:**

1.  **Dodaj nową sekcję: `:link: Cached Population with .cachePopulate()`**
    *   Wyjaśnij główną korzyść: rozwiązanie problemu N+1 i inteligentną inwalidację.
    *   Podkreśl, że można jej używać samodzielnie lub z `.cacheQuery()`.

2.  **Podaj przykłady użycia:**
    *   **Prosty przykład:** `User.findOne().cachePopulate({ path: 'friends' })`
    *   **Populacja z `select`:** `User.findOne().cachePopulate({ path: 'friends', select: 'name' })`
    *   **Populacja wielu ścieżek:** `User.findOne().cachePopulate([{ path: 'friends' }, { path: 'company' }])`
    *   **Użycie z `cacheQuery`:** `User.find().cacheQuery().cachePopulate({ path: 'friends' })`
    *   **Ustawianie niestandardowego TTL:** `User.findOne().cachePopulate({ path: 'friends', ttl: 300 })`
    *   **Kontrola dziedziczenia TTL:** `User.findOne().cachePopulate({ path: 'friends', ttl: 300, ttlInheritance: 'override' })`

3.  **Wyjaśnij mechanizm inwalidacji:**
    *   Opisz w prosty sposób, że zmiana w dokumencie `Friend` automatycznie unieważni cache wszystkich dokumentów `User`, które go populowały.

4.  **Zaktualizuj roadmapę (`:dart: Roadmap`):**
    *   Oznacz pozycję "Cache-based population" jako zrealizowaną (`[x]`).
    *   Dodaj nową pozycję "Deep population support for .cachePopulate()" na przyszłość.
    *   Dodaj pozycję "LRU eviction for in-memory cache"
    *   Dodaj pozycję "Metrics collection for cache operations"
    *   Dodaj pozycję "Concurrency control for recursive invalidation"

