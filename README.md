<div align="center">

<img src="resources/icon.png" width="100" />

# Liquid Torrent

**Современный, быстрый и стильный торрент-клиент для Windows**

[![Version](https://img.shields.io/badge/version-1.3.0-blue?style=for-the-badge)](https://github.com/dmitrymx/liquid-torrent/releases)
[![Electron](https://img.shields.io/badge/Electron-36-47848F?style=for-the-badge&logo=electron)](https://electronjs.org)
[![License](https://img.shields.io/badge/license-MIT-green?style=for-the-badge)](LICENSE)

*Торрент-клиент нового поколения с премиальным дизайном и нулевым потреблением ресурсов*

---

</div>

## ✨ Возможности

- 🎨 **Премиальный UI** — тёмная тема с неоновыми акцентами, SVG-анимации, glassmorphism
- ⚡ **Высокая производительность** — оптимизирован для работы с торрентами 155+ ГБ без тормозов
- 📁 **Поддержка .torrent файлов** — открывайте `.torrent` файлы прямо из Проводника
- 🧲 **Магнет-ссылки** — мгновенное добавление через `magnet:` протокол
- 💾 **Мгновенный запуск** — торренты восстанавливаются из сохранённых `.torrent` файлов параллельно
- ⏸️ **Управление загрузками** — пауза/продолжение, индивидуальные лимиты скорости
- 📊 **Визуализация скорости** — график скорости в реальном времени (Canvas)
- 🔔 **Системный трей** — работает в фоне с контекстным меню
- 📂 **Дерево файлов** — иерархический просмотр файлов торрента
- 🛡️ **Портативный** — один `.exe` файл, без установки

## 📸 Скриншот

<div align="center">

*Скриншот приложения будет добавлен позже*

</div>

## 🚀 Установка

### Портативная версия (рекомендуется)

1. Скачайте `LiquidTorrent-1.3.0-portable.exe` из раздела [Releases](https://github.com/dmitrymx/liquid-torrent/releases)
2. Запустите — готово!

Не требует установки. Данные хранятся в `%AppData%/liquid-torrent`.

### Сборка из исходников

```bash
# Клонировать репозиторий
git clone https://github.com/dmitrymx/liquid-torrent.git
cd liquid-torrent

# Установить зависимости
npm install

# Запустить в режиме разработки
npm run dev

# Собрать портативный EXE
npm run dist:portable
```

## 🛠 Технологии

| Компонент | Технология |
|-----------|------------|
| Фреймворк | Electron 36 + electron-vite |
| UI | React 19 + TypeScript |
| Стейт | Zustand 5 |
| Торрент-движок | WebTorrent 2.5 |
| Иконки | Lucide React |
| Сборка | electron-builder (portable) |

## ⚙️ Архитектура

```
src/
├── main/                # Electron Main Process
│   ├── index.ts         # Window, IPC, Tray, file associations
│   ├── torrent.ts       # Thin proxy → utilityProcess (15KB)
│   └── torrent-worker.ts # WebTorrent engine (отдельный процесс!)
├── preload/
│   └── index.ts         # Context bridge (IPC ↔ Renderer)
└── renderer/            # React UI
    ├── App.tsx          # Главный компонент + polling loop
    ├── store/           # Zustand state management
    ├── components/      # UI компоненты
    └── styles/          # CSS (тёмная тема, анимации)
```

### Ключевое решение: utilityProcess

```
Renderer ←IPC→ Main Process (Window/IPC/Tray)
                    ↓ postMessage (async)
               UtilityProcess (WebTorrent Engine)
               ↑ отдельный OS-процесс, не блокирует UI
```

### Оптимизации производительности (v1.3.0)

- **Лёгкий polling** — основной цикл запрашивает только состояние торрентов (без файлов/трекеров)
- **Кэш метаданных** — файлы и трекеры кэшируются один раз при получении метаданных
- **Ленивая загрузка** — полная информация загружается по запросу (при выборе торрента)
- **React.memo** — карточки торрентов не перерисовываются если данные не изменились
- **Параллельное восстановление** — все торренты восстанавливаются одновременно при запуске

## 📋 Горячие клавиши

| Действие | Клавиша |
|----------|---------|
| Добавить .torrent | Кнопка «Добавить» |
| Добавить магнет | Кнопка «Магнет» |
| Пауза/Старт выбранного | ПКМ → Пауза/Продолжить |
| Удалить торрент | ПКМ → Удалить |
| Поиск | Строка поиска вверху |

## 👨‍💻 Автор

**Максимов Д.А.**
- 🌐 [mxmvdev.ru](https://mxmvdev.ru)
- 💬 [Telegram: @dmitrymx](https://t.me/dmitrymx)

## 📄 Лицензия

MIT © 2026 Максимов Д.А.
