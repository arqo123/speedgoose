
# Plan Implementacji `.cachePopulate()`

## Wprowadzenie

Celem tego planu jest wdrożenie nowej metody `.cachePopulate()`, która będzie wydajnym, cachującym substytutem dla `.populate()`. Główne założenia to rozwiązanie problemu N+1 poprzez masowe pobieranie danych z cache, inteligentna inwalidacja cache "w górę" (od dziecka do rodzica) oraz elastyczne API.
