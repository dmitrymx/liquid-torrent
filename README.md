<div align="center">

<img src="resources/icon.png" width="100" />

# Liquid Torrent

**Современный, быстрый и стильный торрент-клиент для Windows**

[![Version](https://img.shields.io/badge/version-1.5.0-blue?style=for-the-badge)](https://github.com/dmitrymx/liquid-torrent/releases)
[![Electron](https://img.shields.io/badge/Electron-36-47848F?style=for-the-badge&logo=electron)](https://electronjs.org)
[![libtorrent](https://img.shields.io/badge/libtorrent-2.0.11-orange?style=for-the-badge)](https://libtorrent.org)
[![License](https://img.shields.io/badge/license-MIT-green?style=for-the-badge)](LICENSE)

*Торрент-клиент нового поколения с движком libtorrent (C++) и премиальным дизайном*

---

</div>

## ✨ Возможности

- 🚀 **Движок libtorrent 2.0.11 (C++)** — тот же движок что в qBittorrent, скорости 30+ МБ/с
- 🎨 **Премиальный UI** — тёмная тема с неоновыми акцентами, SVG-анимации, glassmorphism
- ⚡ **Нулевые тормоза** — торрент-движок работает в отдельном процессе, UI никогда не зависает
- 💾 **Мгновенное восстановление** — торренты восстанавливаются из resume data без перехеширования
- 📁 **Поддержка .torrent файлов** — открывайте `.torrent` файлы прямо из Проводника
- 🧲 **Магнет-ссылки** — мгновенное добавление через `magnet:` протокол
- ⏸️ **Управление загрузками** — пауза/продолжение, индивидуальные лимиты скорости
- 📊 **Визуализация скорости** — график скорости в реальном времени (Canvas)
- 🔔 **Системный трей** — работает в фоне с контекстным меню
- 📂 **Дерево файлов** — иерархический просмотр файлов торрента
- 🛡️ **Портативный** — один `.exe` файл, без установки, Python не нужен

## 📸 Скриншот

<div align="center">

*Скриншот приложения будет добавлен позже*

</div>

## 🚀 Установка

### Портативная версия (рекомендуется)

1. Скачайте `LiquidTorrent-1.5.0-portable.exe` из раздела [Releases](https://github.com/dmitrymx/liquid-torrent/releases)
2. Запустите — готово!

Не требует установки. Python на целевом ПК **не нужен** — libtorrent упакован внутри.

### Сборка из исходников

```bash
# Клонировать репозиторий
git clone https://github.com/dmitrymx/liquid-torrent.git
cd liquid-torrent

# Установить зависимости
npm install

# Запустить в режиме разработки (требует Python 3.11 + libtorrent)
npm run dev

# Собрать sidecar (PyInstaller)
python -m PyInstaller --onefile --noconsole --name torrent_sidecar \
  --distpath "scripts/dist" scripts/torrent_sidecar.py

# Собрать портативный EXE
npm run dist:portable
```

## 🛠 Технологии

| Компонент | Технология |
|-----------|------------|
| Фреймворк | Electron 36 + electron-vite |
| UI | React 19 + TypeScript |
| Стейт | Zustand 5 |
| Торрент-движок | **libtorrent 2.0.11** (C++ через Python sidecar) |
| Иконки | Lucide React |
| Сборка | electron-builder (portable) + PyInstaller |

## ⚙️ Архитектура

```
Electron Main Process (torrent.ts — thin proxy)
    ↕  child_process.spawn + stdin/stdout JSON-RPC
Python Sidecar (torrent_sidecar.exe — PyInstaller bundle)
    ↕  python-libtorrent bindings
libtorrent 2.0.11 (C++ native engine)
```

```
src/
├── main/                  # Electron Main Process
│   ├── index.ts           # Window, IPC, Tray, file associations
│   └── torrent.ts         # Thin JSON-RPC proxy → Python sidecar
├── preload/
│   └── index.ts           # Context bridge (IPC ↔ Renderer)
├── renderer/              # React UI
│   ├── App.tsx            # Главный компонент + polling loop
│   ├── store/             # Zustand state management
│   ├── components/        # UI компоненты
│   └── styles/            # CSS (тёмная тема, анимации)
└── scripts/
    ├── torrent_sidecar.py # Headless libtorrent engine (JSON-RPC)
    └── dist/
        └── torrent_sidecar.exe  # PyInstaller bundle (~10.5 МБ)
```

### Почему libtorrent, а не WebTorrent?

| Метрика | WebTorrent (старый) | libtorrent (текущий) |
|---------|--------------------|--------------------|
| Скорость скачивания | 5-15 МБ/с | **15-35+ МБ/с** |
| SHA1 верификация | JS event loop (блокирует) | C++ async threads |
| Resume data | Нет (перехеш при запуске) | Native (мгновенный старт) |
| Влияние на UI | Зависает при больших торрентах | **Нулевое** (отдельный процесс) |

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
