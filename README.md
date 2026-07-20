# Stookii-me

An all-in-one **retail business management system** — a cleaner, more capable take on the kind of cloud business tool Monakom offers. Built for a Cambodia retail context (USD + Riel, VAT, local suppliers & payment methods like ABA / Wing).

## Modules

| Module | What it does |
| --- | --- |
| **Dashboard** | Live KPIs (today's sales, revenue, profit, low stock), revenue/profit trend, top products, category mix, reorder alerts, busiest hours. Range filter (today / 7d / 30d / 90d). |
| **Point of Sale** | Searchable product grid by category, cart with qty controls, customer + discount + payment method, automatic VAT, USD & Riel totals, **real KHQR digital payments** (see below), printable receipt. Stock and loyalty update on checkout. |
| **Inventory** | Product table with cost/price/margin/stock, status badges, add/edit/delete, one-click restock, low-stock KPIs. |
| **Customers** | Loyalty points, spend history, auto tiers (Bronze/Silver/Gold), add/edit/delete, search. |
| **Reports** | Gross/net revenue, profit, margin, COGS, VAT, discounts; daily revenue-vs-profit chart; payment-method split; top products; recent transactions; CSV export; reset demo data. |

## KHQR digital payments (Bakong)

The POS can take **real KHQR payments** — the national QR standard run by Bakong / NBC, scannable by any Cambodian banking app (ABA, ACLEDA, Wing, etc.).

**How it works at checkout:** pick **KHQR** as the payment method → a dynamic QR for the exact amount is shown with a 5-minute countdown → the system polls Bakong until the customer pays → the sale auto-commits (stock + loyalty) and prints the receipt. The confirmed transaction's hash is stored on the sale (`paymentRef`).

**Two modes:**
- **Live** — set `BAKONG_ACCOUNT_ID` + `BAKONG_API_TOKEN` in `.env.local`. Real QR, real payment confirmation via the Bakong Open API.
- **Simulation** (default, no setup) — generates a demo QR and a "Simulate customer payment" button so you can test the whole flow before credentials arrive.

**Going live:**
1. Copy `.env.local.example` → `.env.local`.
2. Fill in your Bakong account ID (e.g. `name@aclb`), merchant name/city, and a developer token from <https://api-bakong.nbc.gov.kh>.
3. Restart `npm run dev`. The "Simulate" button disappears and payments are confirmed for real.

> Tokens from the Bakong Open API expire about every 3 months — renew when payment confirmation stops working.

### Payment API

| Method | Route | Purpose |
| --- | --- | --- |
| POST | `/api/payments/khqr` | generate a dynamic KHQR (returns `qr`, `md5`, `qrImage`, `mode`) |
| GET | `/api/payments/khqr/status?md5=…` | check if that QR has been paid |
| POST | `/api/payments/khqr/simulate` | (sim mode only) mark a QR paid for testing |

## Tech

- **Next.js 14** (App Router) + **TypeScript** + **Tailwind CSS**
- **Recharts** for charts, **lucide-react** for icons
- **bakong-khqr** + **qrcode** for KHQR generation and confirmation
- **File-based JSON store** at `data/db.json` via REST API routes (no database to install). Seeds itself with ~45 days of realistic sample sales on first run.

## Run it

```bash
npm install
npm run dev      # http://localhost:3200
```

Build for production:

```bash
npm run build && npm start
```

## Data

- The store seeds automatically the first time an API route is hit (`data/db.json`).
- Delete `data/db.json` (or use **Reports → Reset demo**) to regenerate the sample data.
- Business settings (name, VAT rate, exchange rate, address) live under `meta.business` in the same file.

## API

| Method | Route | Purpose |
| --- | --- | --- |
| GET / POST | `/api/products` | list / create products |
| PATCH / DELETE | `/api/products/[id]` | update / delete (also used for restock) |
| GET / POST | `/api/customers` | list / create customers |
| PATCH / DELETE | `/api/customers/[id]` | update / delete |
| GET / POST | `/api/sales` | list / create a sale (decrements stock, updates loyalty, issues invoice) |
| GET | `/api/stats?range=today\|7d\|30d\|90d` | aggregated analytics |
| POST | `/api/reset` | restore seeded demo data |
