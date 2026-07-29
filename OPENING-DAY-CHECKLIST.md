# ON Mart — Opening Day Checklist (Friday 1 Aug 2026)

## Before Friday (do these Wednesday/Thursday)

- [ ] **Install the new till app (APK) on all 3 tills.**
  GitHub → KUNIKO → Actions → newest "sunmi-apk" run → download the APK → install on each Sunmi T3.
  This one install brings: the loading fix, the Khmer receipt, condiment kitchen tickets, and the cancellation slip.
- [ ] **Print ONE test receipt on a real till** and read the Khmer carefully — it has never been on paper.
  Also check these words I wrote myself: វិក្កយបត្រលុបចោល (cancelled invoice), សងប្រាក់វិញ (refunded), ប្រាក់អាប់ (change), លេខផ្ទាំងហៅ (ticket), ជាប្រាក់រៀល (KHR, customer screen).
- [ ] **KHQR money**: Render → your service → Environment → add `BAKONG_ACCOUNT_ID` and `BAKONG_API_TOKEN`.
  ⚠ Without these, the QR code shows and says "paid" but NO money moves. If they can't be set in time, take cash + ABA transfer only.
- [ ] **Stock count** the negative-stock shelves (worst first): Aer O fresheners, ON-Bacon/Beef Noodle ingredients, ICE Shaken Coffee, all buns.
- [ ] **Set staff PINs**: Job Schedule → each employee → 6-digit PIN. Managers' PINs are also their approval code for cancelling invoices.
- [ ] **Cash float**: agree the opening drawer amount with each cashier.

## Friday morning, before doors open

- [ ] Manager signs in on each till → Till Mode.
- [ ] Each cashier takes their till with their own PIN (one person = one till).
- [ ] Ring up ONE real test sale, cash — check: receipt prints, drawer opens, customer screen shows the basket, pickup number appears on the kitchen screen.
- [ ] Cancel that test sale (manager PIN) — check the cancellation slip prints.
- [ ] Sell ONE noodle — check the spicy-level question appears and reaches the kitchen screen.

## If something goes wrong during the day

| Problem | Do this |
|---|---|
| Till screen stuck / blank | Close the Stookii app fully and reopen it. It self-heals. |
| "No connection to the store" | Check the shop wifi first — the message means the till can't reach the internet. |
| Wrong PIN locked someone out | Wait 15 minutes, or they can sign in on the other till. |
| Printed receipt wrong / printer jammed | The sale is SAFE on the server — reprint from Invoices. Never re-ring it. |
| Customer paid twice by mistake | Invoices → find it → Cancel (needs a manager PIN) — the slip prints as proof. |

## Numbers that mean "all is well" (check Saturday morning)

- Reports → Sales: yesterday's revenue by till and average basket.
- Money → Cash report: drawer variance near $0.
- Every cancelled invoice has a reason and an approver name.
