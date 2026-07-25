package me.stookii.printer

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.IBinder
import android.util.Base64
import org.json.JSONObject
import woyou.aidlservice.jiuiv5.ICallback
import woyou.aidlservice.jiuiv5.IWoyouService

/**
 * Talks to the Sunmi built-in printer via its AIDL service and renders the JSON
 * receipt that Stookii sends over the JS bridge. Binds lazily and queues work
 * until the service is connected.
 */
class SunmiPrinter(private val context: Context) {

    private var service: IWoyouService? = null
    private val pending = ArrayDeque<(IWoyouService) -> Unit>()

    // A no-op callback — we don't need per-call results for a fire-and-forget till.
    private val cb = object : ICallback.Stub() {
        override fun onRunResult(isSuccess: Boolean) {}
        override fun onReturnString(result: String?) {}
        override fun onRaiseException(code: Int, msg: String?) {}
        override fun onPrintResult(code: Int, msg: String?) {}
    }

    private val conn = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, binder: IBinder?) {
            val s = IWoyouService.Stub.asInterface(binder)
            service = s
            try {
                s.printerInit(cb)
            } catch (_: Exception) {
            }
            while (pending.isNotEmpty()) pending.removeFirst()(s)
        }

        override fun onServiceDisconnected(name: ComponentName?) {
            service = null
        }
    }

    fun bind() {
        if (service != null) return
        val intent = Intent().apply {
            setPackage("woyou.aidlservice.jiuiv5")
            action = "woyou.aidlservice.jiuiv5.IWoyouService"
        }
        try {
            context.applicationContext.bindService(intent, conn, Context.BIND_AUTO_CREATE)
        } catch (_: Exception) {
        }
    }

    private fun run(block: (IWoyouService) -> Unit) {
        val s = service
        if (s != null) {
            try {
                block(s)
            } catch (_: Exception) {
            }
        } else {
            pending.addLast(block)
            bind()
        }
    }

    // The jiuiv5 interface has no cutPaper/openDrawer methods — both are driven
    // by raw ESC/POS bytes, the same way Sunmi's own helpers do it.
    private val CUT = byteArrayOf(0x1D, 0x56, 0x42, 0x00) // GS V B 0 — feed + full cut
    private val KICK = byteArrayOf(0x10, 0x14, 0x00, 0x00, 0x00) // DLE DC4 — drawer pulse

    private fun cut(s: IWoyouService) = s.sendRAWData(CUT, cb)
    private fun kick(s: IWoyouService) = s.sendRAWData(KICK, cb)

    fun openDrawer() = run { kick(it) }

    /**
     * Render + print the receipt described by the JSON payload from Stookii.
     * Follows the store's Invoice Customization: logo, header note, whether the
     * VAT breakdown and pickup number print, and the footer note — the same
     * design rules as the on-screen receipt.
     */
    fun printReceipt(json: String) = run { s ->
        val r = JSONObject(json)
        val store = r.optJSONObject("store") ?: JSONObject()

        s.setAlignment(1, cb) // centre
        // Store logo (a data-URL image) at the top, when the owner turned it on.
        r.optString("logo").takeIf { it.isNotBlank() }?.let { dataUrl ->
            decodeLogo(dataUrl)?.let { bmp ->
                try {
                    s.printBitmap(bmp, cb)
                    s.printText("\n", cb)
                } catch (_: Exception) {
                }
            }
        }
        s.printTextWithFont((store.optString("name", "Stookii") + "\n"), null, 32f, cb)
        s.setFontSize(BODY, cb)
        store.optString("address").takeIf { it.isNotBlank() }?.let { s.printText(it + "\n", cb) }
        store.optString("phone").takeIf { it.isNotBlank() }?.let { s.printText(it + "\n", cb) }
        r.optString("headerNote").takeIf { it.isNotBlank() }?.let { s.printText(it + "\n", cb) }

        s.setAlignment(0, cb) // left
        s.printText(divider(), cb)
        s.printText("Invoice: " + r.optString("invoiceNo") + "\n", cb)
        s.printText(r.optString("dateTime") + "\n", cb)
        r.optString("cashier").takeIf { it.isNotBlank() }?.let { s.printText("Cashier: $it\n", cb) }
        s.printText(divider(), cb)

        // Items — name on the left, line total on the right. Built as manually
        // space-padded single strings and printed with printText — NOT
        // printColumnsString, whose AIDL slot silently drops every two-column
        // line on this T3 (items + totals vanished from the printed slip).
        val items = r.optJSONArray("items")
        if (items != null) for (i in 0 until items.length()) {
            val it = items.getJSONObject(i)
            val name = it.optString("name")
            val qty = it.optString("qtyLabel")
            val amt = usd(it.optDouble("lineTotal"))
            val amtR = khrCol(it.optLong("lineRiel"))
            // Three columns: qty+name (left), USD, then riel — both right-aligned
            // in fixed fields so every row's $ and R line up.
            s.printText(col3("$qty  $name", amt, amtR), cb)
        }

        // Promotion lines — name on the left, amount off on the right.
        val promos = r.optJSONArray("promotions")
        if (promos != null && promos.length() > 0) {
            s.printText(divider(), cb)
            for (i in 0 until promos.length()) {
                val p = promos.getJSONObject(i)
                s.printText(col2(p.optString("name"), "-" + usd(p.optDouble("discount"))), cb)
            }
        }
        s.printText(divider(), cb)

        val discount = r.optDouble("discount", 0.0)
        if (discount > 0) row(s, "Discount", "-" + usd(discount))
        // The VAT breakdown only prints when Invoice Customization says so; the
        // default design is just the total with an "Includes VAT x%" note.
        val showVat = r.optBoolean("showVat", false)
        if (showVat) {
            row(s, "Subtotal (ex VAT)", usd(r.optDouble("subtotal")))
            row(s, "VAT", usd(r.optDouble("vat")))
        }
        // TOTAL — centred and enlarged: the dollar AND the riel together on one
        // line, then the "Includes VAT" note beneath it.
        s.setAlignment(1, cb)
        s.printTextWithFont(
            "TOTAL   " + usd(r.optDouble("total")) + "   " + khrCol(r.optLong("totalRiel")) + "\n",
            null, 32f, cb,
        )
        s.setFontSize(BODY, cb)
        if (!showVat) {
            val pct = r.optInt("vatPct", 10)
            s.printText("Includes VAT $pct%\n", cb)
        }
        s.setAlignment(0, cb)

        s.printText(divider(), cb)
        row(s, "Paid by", r.optString("payment"))
        if (!r.isNull("tendered")) row(s, "Cash received", usd(r.optDouble("tendered")))
        if (!r.isNull("change")) row(s, "Change", usd(r.optDouble("change")))
        r.optString("customer").takeIf { it.isNotBlank() }?.let { row(s, "Customer", it) }

        if (!r.isNull("queueNumber") && r.optBoolean("showPickup", true)) {
            s.printText("\n", cb)
            s.setAlignment(1, cb)
            s.printText("PICKUP NUMBER\n", cb)
            s.printTextWithFont(pad3(r.optInt("queueNumber")) + "\n", null, 48f, cb)
        }

        s.setAlignment(1, cb)
        r.optString("footerNote").takeIf { it.isNotBlank() }?.let { s.printText(it + "\n", cb) }
        s.printText("Thank you!\n", cb)
        s.lineWrap(2, cb)
        cut(s)

        if (r.optBoolean("openDrawer", false)) kick(s)
    }

    /**
     * Decode the receipt logo (a "data:image/...;base64,..." URL from Invoice
     * Customization) and scale it to the printer head's width. Returns null on
     * anything unexpected — the receipt then just prints without a logo.
     */
    private fun decodeLogo(dataUrl: String): Bitmap? {
        return try {
            val b64 = dataUrl.substringAfter("base64,", "")
            if (b64.isBlank()) return null
            val bytes = Base64.decode(b64, Base64.DEFAULT)
            val bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: return null
            // 384 dots is the classic 58mm head; scale down only, never up.
            val maxW = 360
            if (bmp.width <= maxW) bmp
            else Bitmap.createScaledBitmap(bmp, maxW, (bmp.height.toLong() * maxW / bmp.width).toInt().coerceAtLeast(1), true)
        } catch (_: Exception) {
            null
        }
    }

    /**
     * Print a generic cash/till slip (Safe Drop, Bank Transfer, Shift Close,
     * Shift Survey). Same printer, different shape from a sales receipt: a titled
     * header then a flat list of typed lines the web app sends.
     */
    fun printSlip(json: String) = run { s ->
        val r = JSONObject(json)
        val store = r.optJSONObject("store") ?: JSONObject()

        s.setAlignment(1, cb) // centre
        s.printTextWithFont(store.optString("name", "Store") + "\n", null, 30f, cb)
        s.setFontSize(22f, cb)
        store.optString("contact").takeIf { it.isNotBlank() }?.let { s.printText(it + "\n", cb) }
        s.setFontSize(30f, cb)
        s.printText(r.optString("title") + "\n", cb)
        s.setFontSize(22f, cb)
        r.optString("subtitle").takeIf { it.isNotBlank() }?.let { s.printText(it + "\n", cb) }

        s.setAlignment(0, cb) // left
        val lines = r.optJSONArray("lines")
        if (lines != null) for (i in 0 until lines.length()) {
            val ln = lines.getJSONObject(i)
            when (ln.optString("t")) {
                "hr" -> s.printText(divider(), cb)
                // Section heading — no blank line before it (the divider above
                // already separates sections) to save paper.
                "sec" -> s.printText(ln.optString("a") + "\n", cb)
                // Every data row prints at the one BODY font so the value column
                // lines up on every row. (The old `big` rows jumped to a larger
                // font, which pushed their values out of the column.)
                "row" -> row(s, ln.optString("a"), ln.optString("b"))
                "center" -> {
                    s.setAlignment(1, cb)
                    s.printText(ln.optString("a") + "\n", cb)
                    s.setAlignment(0, cb)
                }
                "left" -> s.printText(ln.optString("a") + "\n", cb)
                // Signature line — no blank line before it; the label + underscores
                // are one line you sign on, so consecutive lines are fine.
                "sig" -> s.printText(ln.optString("a") + ": ______________\n", cb)
            }
        }

        // Just enough feed to clear the cutter, no big trailing gap.
        s.lineWrap(2, cb)
        cut(s)
        if (r.optBoolean("openDrawer", false)) kick(s)
    }

    private fun row(s: IWoyouService, label: String, value: String) {
        s.printText(col2(label, value), cb)
    }

    // This 80mm head prints ~48 monospace chars per line at the body font size
    // (the store's full address fills one line). Build a two-column line by
    // padding the gap between label and value so the value sits flush right —
    // reliable printText, no printColumnsString.
    private val BODY = 22f
    private val WIDTH = 48
    private fun col2(left: String, right: String): String {
        val maxLeft = (WIDTH - right.length - 1).coerceAtLeast(0)
        val l = if (left.length > maxLeft) left.substring(0, maxLeft) else left
        val gap = (WIDTH - l.length - right.length).coerceAtLeast(1)
        return l + " ".repeat(gap) + right + "\n"
    }

    // Three columns: left (name) fills the remainder, then a USD field and a riel
    // field, each right-aligned to a fixed width so the $ and R columns line up
    // on every row.
    private val USDW = 7
    private val RIELW = 9
    private fun col3(left: String, mid: String, right: String): String {
        val leftMax = (WIDTH - USDW - RIELW).coerceAtLeast(0)
        val l = if (left.length > leftMax) left.substring(0, leftMax) else left
        return l.padEnd(leftMax) + mid.padStart(USDW) + right.padStart(RIELW) + "\n"
    }

    private fun divider() = "-".repeat(WIDTH) + "\n"
    private fun usd(v: Double) = "$" + String.format("%.2f", v)
    private fun khr(v: Long) = String.format("%,d", v) + " R"
    // Compact riel for the item column (no space, so it fits the fixed field).
    private fun khrCol(v: Long) = String.format("%,d", v) + "R"
    private fun pad3(n: Int) = n.toString().padStart(3, '0')
}
