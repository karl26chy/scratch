# Scraper & Surebet Engine (Monorepo)

Sistema modular en Node.js + Express + TypeScript (Backend) y React 18 + Vite + TypeScript (Frontend) diseñado para la extracción concurrente y masiva de cuotas en casas de apuestas deportivas con arquitectura de evasión anti-bot multicapa y cálculo matemático de arbitraje deportivo (*Surebets*).

---

## 🚀 Requisitos Previos

* **Node.js** (Versión 18 o superior recomendada, probado en v24.x)
* **npm** (v9+) o yarn

---

## 📦 Instalación y Configuración

1. Clona el repositorio e instala las dependencias en la raíz del monorepo:
   ```bash
   git clone https://github.com/tu-usuario/scraper.git
   cd scraper
   npm install
   ```

2. Instala los binarios del navegador Chromium para Playwright:
   ```bash
   npx playwright install chromium
   ```

---

## 🛠️ Ejecución del Proyecto

### Modo Desarrollo (Frontend + Backend simultáneo)
```bash
npm run dev
```
* **Frontend UI**: [http://localhost:3000](http://localhost:3000)
* **Backend API**: [http://localhost:4000](http://localhost:4000)
* **Health Check**: [http://localhost:4000/api/v1/health](http://localhost:4000/api/v1/health)

### Compilación y Build de Producción
```bash
npm run build
```

---

## 🏛️ Arquitectura del Sistema

```
scratch/
├── apps/
│   ├── backend/
│   │   └── src/
│   │       ├── domain/types/               # DTOs de Scraping, Surebets y Proxies
│   │       ├── infrastructure/
│   │       │   ├── browser/                # Playwright Stealth, Browser Pool & Context Isolation
│   │       │   ├── fingerprints/           # Generador de huellas (WebGL, Canvas, User-Agents)
│   │       │   ├── proxies/                # Rotador de proxies residenciales con Sticky Sessions
│   │       │   └── selectors/              # Resilient Selector Engine & Detección de Anomalías DOM
│   │       ├── services/
│   │       │   ├── evasion.service.ts      # Curvas de Bézier, scroll humano y detección anti-bot
│   │       │   ├── scraper.service.ts      # Scraping masivo multi-hilo con Promise.all
│   │       │   ├── surebet-calculator.service.ts # Motor matemático de arbitraje (TIP < 1.0)
│   │       │   └── stochastic.utils.ts     # Distribuciones Gaussianas Box-Muller
│   │       └── presentation/
│   │           ├── controllers/            # Controladores API (Scraper, Surebets)
│   │           └── routes/                 # Endpoints REST (/api/scrape, /api/surebets)
│   │
│   └── frontend/
│       └── src/
│           ├── modules/
│           │   ├── dashboard/              # Telemetría de evasión y métricas del pool
│           │   ├── scrapers/               # Consola multi-hilo de scraping para casas de apuestas
│           │   └── surebets/               # Feed en tiempo real y analizador manual de arbitraje
│           └── shared/                     # Componentes atómicos (Header, Sidebar, Card, Badge)
```

---

## 🧠 Características Principales

1. **Evasión Anti-Bot Automatizada y Nivel Paranoico:**
   * Enmascaramiento completo de `navigator.webdriver` y propiedades prototype.
   * Spoofing de WebGL Vendor/Renderer, Canvas Noise y AudioContext.
   * Limpieza de descriptores internos de automatización CDP (`cdc_*`).
   * Aislamiento estricto de contextos efímeros (`browser.newContext`) por tarea o hilo.

2. **Scraping Masivo Concurrente (Multi-Hilo):**
   * Procesamiento en paralelo de al menos 7 casas de apuestas en simultáneo mediante `Promise.all`.
   * Rotación dinámica de proxies residenciales con failover reactivo y cuarentena de 5 minutos ante desafíos Cloudflare/Datadome.
   * Extracción automática de cuotas decimales y mercados usando selectores estables del DOM.

3. **Módulo de Arbitraje Deportivo y Surebets:**
   * Cálculo matemático de Probabilidad Implícita Total ($\text{TIP} = \sum \frac{1}{\text{cuota}_i}$).
   * Detección de condición de Surebet ($\text{TIP} < 1.0$) y optimización de capital (*Stakes*).
   * Calculadora interactiva de *Bankroll* con retorno financiero garantizado libre de riesgo.
   * Estado inicial limpio basado exclusivamente en datos reales capturados o ingresados por el usuario.
