# TEMORA ⏳

[![Deploy to GitHub Pages](https://github.com/jnjal/temora/actions/workflows/deploy.yml/badge.svg)](https://github.com/jnjal/temora/actions/workflows/deploy.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-white.svg)](LICENSE)

> A distraction-free, pitch-black minimalist count-up focus timer designed for deep work, complete with 7-day productivity tracking and ambient audio streams.

---

## ✨ Features

- **⏱️ Minimalist Count-Up Focus Timer**: Set an activity title and target duration with quick presets (30m, 1h, 1.5h, 2h) or custom hours & minutes.
- **⚡ Tab-Throttling & Drift Immunity**: Built with timestamp-synchronized tracking and `visibilitychange` listeners. Never loses a second even when backgrounded or during system sleep.
- **🔄 3-2-1 Audio Countdown**: Pleasant Web Audio API frequency tones guide your transition into deep focus.
- **📊 7-Day Productivity Analytics**:
  - Tracks daily completed focus sessions.
  - Calculates daily productivity percentage relative to 24-hour day (`dayTotal / 86,400s`).
  - Aggregates total weekly focus time.
  - Automatic 7-day rolling data retention via `localStorage`.
- **🎧 Ambient Audio & YouTube Streamer**:
  - Integrated presets: *Lofi Girl*, *Lofi Chill*, *Jazz & Lofi*, and *Ambient Rain*.
  - Full support for custom YouTube links (Standard, Shorts, Live streams, Embed, and raw IDs).
  - Background audio playback during focus sessions.
- **⌨️ Keyboard Shortcuts**:
  - `Space` — Toggle Pause / Resume timer.
  - `Enter` — Start timer from creation screen.
  - `Escape` — Close open modals (Music / History / Creation).
- **🏷️ Dynamic Document Title**: Displays live elapsed time and activity name directly in your browser tab (`01:24:10 • Writing - TEMORA`).
- **🎉 Completion Celebration**: Gentle completion chime and monochrome confetti animation upon finishing a session.
- **📲 Installable PWA**: Add to home screen on Android/iOS, standalone fullscreen mode, and offline support via service worker.
- **🖤 Pitch-Black OLED Design**: Pure black (`#000000`) theme with high-contrast typography and subtle zinc accents.

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (version 18 or higher)
- `npm` or `bun`

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/jnjal/temora.git
   cd temora
   ```

2. **Install dependencies:**
   ```bash
   npm install
   # or
   bun install
   ```

3. **Start the development server:**
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000) in your browser.

4. **Build for production:**
   ```bash
   npm run build
   ```

---

## 🛠️ Tech Stack

- **Framework**: [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)
- **Bundler**: [Vite 6](https://vitejs.dev/)
- **Styling**: [Tailwind CSS v4](https://tailwindcss.com/)
- **Animations**: [Motion](https://motion.dev/)
- **Icons**: [Lucide React](https://lucide.dev/)
- **Sound**: Native Web Audio API Synthesizer
- **Visual FX**: [canvas-confetti](https://www.npmjs.com/package/canvas-confetti)
- **PWA**: [vite-plugin-pwa](https://vite-pwa-org.netlify.app/) + Workbox (manifest, service worker, offline cache)
- **CI/CD**: GitHub Actions (`.github/workflows/deploy.yml`)

---

## 🌐 Deployment to GitHub Pages

This project is pre-configured for automated deployment to GitHub Pages via GitHub Actions:

1. Fork the `main` branch.
2. In your GitHub repository:
   - Navigate to **Settings** > **Pages**.
   - Under **Build and deployment** > **Source**, select **GitHub Actions**.
3. The workflow (`.github/workflows/deploy.yml`) will build and deploy the app automatically to:
   ```
   https://<username>.github.io/temora/
   ```

---

## 📄 License

This project is open-source and available under the [MIT License](LICENSE).
