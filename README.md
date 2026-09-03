# Рамина — Волшебный день v0.1

PWA для домашних заданий, валюты «Крузейрики» и магазина наград с обязательным подтверждением родителя.

## Важно
- Данные не хранятся одним большим JSON.
- Баланс меняется только через Firestore transaction.
- Покупка сначала создаётся со статусом pending. Списание происходит только после подтверждения родителем.
- Постоянный offline-cache Firestore не включён.
- Начальный PIN родителя: **2580**. После первого входа смените его.

## Структура Firestore
Все данные лежат под отдельным корнем `apps/ramina`:

`apps/ramina/profile/main`
`apps/ramina/settings/main`
`apps/ramina/tasks/{taskId}`
`apps/ramina/completions/{YYYY-MM-DD_taskId}`
`apps/ramina/rewards/{rewardId}`
`apps/ramina/purchases/{purchaseId}`

## Настройка
1. Создать отдельный Firebase project.
2. В Authentication включить Anonymous provider.
3. Создать Firestore Database.
4. Опубликовать правила из `firestore.rules`.
5. Добавить Web app в Firebase и вставить его `firebaseConfig` в `firebase-config.js`.
6. Загрузить все файлы в отдельный GitHub repo и включить GitHub Pages.
