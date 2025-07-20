
## Faza 8: Kompleksowy Plan Testów

**Cel:** Zapewnienie, że nowa funkcjonalność jest stabilna, wydajna i wolna od regresji. Testy zostaną napisane po zaimplementowaniu logiki z faz 1-7. Użyjemy `jest` i istniejącej infrastruktury testowej.

### 8.1. Przygotowanie Środowiska Testowego

**Pliki do edycji:** `test/setupTestEnv.ts`, `test/types.ts`

**Zadania:**

1.  Zdefiniuj nowe modele testowe, aby umożliwić testowanie relacji:
    *   `UserModel` z polem `friends: [ObjectId]` (relacja one-to-many).
    *   `FriendModel` z polem `bestFriend: ObjectId` (relacja one-to-one).
2.  Zarejestruj te modele w `setupTestEnv.ts` obok istniejącego `TestModel`.

**Przykład (`test/types.ts`):**

```typescript
export type Friend = {
    _id?: string | ObjectId;
    name: string;
    bestFriend?: Friend | string | ObjectId;
};

export type User = {
    _id?: string | ObjectId;
    name: string;
    friends?: (Friend | string | ObjectId)[];
};

export type MongooseUserDocument = Document<string> & User;
export type MongooseFriendDocument = Document<string> & Friend;
```

### 8.2. Testy Jednostkowe (Unit Tests)

**Nowy plik:** `test/utils/populationUtils.test.ts`

**Cel:** Weryfikacja logiki poszczególnych funkcji pomocniczych w izolacji.

**Zadania:**

1.  **Test `getDocumentCacheKey`**: Sprawdź, czy klucze dla dokumentów są generowane w poprawnym formacie.
2.  **Test `handleCachedPopulation`**: Mockuj `getCacheStrategyInstance` i modele Mongoose.
    *   Sprawdź, czy funkcja poprawnie identyfikuje ID do populacji.
    *   Sprawdź, czy poprawnie wywołuje `getDocuments` i `setDocuments`.
    *   Sprawdź, czy poprawnie identyfikuje "cache misses".
    *   Sprawdź, czy poprawnie wywołuje `Model.find` dla brakujących ID z odpowiednim `select`.

### 8.3. Testy Integracyjne (End-to-End)

**Nowy plik:** `test/population.test.ts`

**Cel:** Weryfikacja pełnego przepływu od wywołania `.cachePopulate()` do otrzymania wyniku.

**Scenariusze testowe:**

1.  **Podstawowa populacja:**
    *   **Given:** Użytkownik i 10 przyjaciół w bazie.
    *   **When:** Wywołanie `UserModel.findOne({}).cachePopulate({ path: 'friends' })`.
    *   **Then:** Użytkownik ma pole `friends` wypełnione 10 pełnymi obiektami `Friend`. Wynik jest identyczny z natywnym `.populate()`.

2.  **Populacja z `select`:**
    *   **When:** Wywołanie `UserModel.findOne({}).cachePopulate({ path: 'friends', select: 'name' })`.
    *   **Then:** Pole `friends` zawiera obiekty `Friend` mające tylko pola `_id` i `name`.

3.  **Współdziałanie z `cacheQuery()`:**
    *   **When:** Wywołanie `UserModel.findOne({}).cacheQuery().cachePopulate({ path: 'friends' })`.
    *   **Then:** Przy drugim wywołaniu tego samego zapytania, ani główny dokument, ani populacje nie powinny generować zapytań do bazy.

4.  **Problem N+1:**
    *   **Given:** Użytkownik i 10 przyjaciół. Cache jest pusty.
    *   **When:** Wywołanie `UserModel.findOne({}).cachePopulate({ path: 'friends' })`.
    *   **Then:** Zamockuj `FriendModel.find` i sprawdź, że zostało wywołane **tylko raz** z opcją `{ _id: { $in: [...] } }`.

5.  **Cache Hit / Miss Mix:**
    *   **Given:** 5 z 10 przyjaciół jest już w cache.
    *   **When:** Wywołanie `UserModel.findOne({}).cachePopulate({ path: 'friends' })`.
    *   **Then:** `FriendModel.find` jest wywoływane tylko raz, dla brakujących 5 przyjaciół.

### 8.4. Testy Inwalidacji (Invalidation Tests)

**Nowy plik:** `test/invalidation.test.ts`

**Cel:** Weryfikacja, czy zmiany w dokumentach "dzieci" poprawnie unieważniają cache "rodziców".

**Scenariusze testowe:**

1.  **Aktualizacja dziecka:**
    *   **Given:** `userA` populuje `friendB`. Wynik `UserModel.findById(userA._id).cacheQuery().cachePopulate('friends')` jest w cache.
    *   **When:** `friendB.name = 'New Name'; friendB.save();`.
    *   **Then:** Cache dla zapytania `UserModel.findById(userA._id)...` jest unieważniony. Kolejne wywołanie musi trafić do bazy.

2.  **Usunięcie dziecka:**
    *   **Given:** Jak wyżej.
    *   **When:** `friendB.deleteOne()`.
    *   **Then:** Cache dla `userA` jest unieważniony.

3.  **Inwalidacja kaskadowa i ochrona przed cyklami:**
    *   **Given:** Modele `User -> Team -> Project`. Oraz `User -> Role` i `Role -> User`.
    *   **Test 1 (kaskada):** Zaktualizuj `Project`. Sprawdź, czy cache dla `Team` i `User` został unieważniony.
    *   **Test 2 (cykl):** Zaktualizuj `Role`. Sprawdź, czy proces inwalidacji nie wpadł w nieskończoną pętlę i zakończył się poprawnie, czyszcząc cache dla `User` i `Role` tylko raz.

