package me.stookii.printer

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.os.IBinder
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

    fun openDrawer() = run { it.openDrawer(cb) }

    /** Render + print the receipt described by the JSON payload from Stookii. */
    fun printReceipt(json: String) = run { s ->
        val r = JSONObject(json)
        val store = r.optJSONObject("store") ?: JSONObject()

        s.setAlignment(1, cb) // centre
        s.printTextWithFont((store.optString("name", "Stookii") + "\n"), null, 30f, cb)
        s.setFontSize(22f, cb)
        store.optString("address").takeIf { it.isNotBlank() }?.let { s.printText(it + "\n", cb) }
        store.optString("phone").takeIf { it.isNotBlank() }?.let { s.printText(it + "\n", cb) }

        s.setAlignment(0, cb) // left
        s.printText(divider(), cb)
        s.printText("Invoice: " + r.optString("invoiceNo") + "\n", cb)
        s.printText(r.optString("dateTime") + "\n", cb)
        r.optString("cashier").takeIf { it.isNotBlank() }?.let { s.printText("Cashier: $it\n", cb) }
        s.printText(divider(), cb)

        // Items — name on the left, line total on the right.
        val items = r.optJSONArray("items")
        if (items != null) for (i in 0 until items.length()) {
            val it = items.getJSONObject(i)
            val name = it.optString("name")
            val qty = it.optString("qtyLabel")
            val amt = usd(it.optDouble("lineTotal"))
            s.printColumnsString(arrayOf("$qty  $name", amt), intArrayOf(22, 10), intArrayOf(0, 2), cb)
        }
        s.printText(divider(), cb)

        val discount = r.optDouble("discount", 0.0)
        if (discount > 0) row(s, "Discount", "-" + usd(discount))
        row(s, "Subtotal (ex VAT)", usd(r.optDouble("subtotal")))
        row(s, "VAT", usd(r.optDouble("vat")))
        s.setFontSize(28f, cb)
        row(s, "TOTAL", usd(r.optDouble("total")))
        s.setFontSize(22f, cb)
        s.setAlignment(2, cb)
        s.printText(khr(r.optLong("totalRiel")) + "\n", cb)
        s.setAlignment(0, cb)

        s.printText(divider(), cb)
        row(s, "Paid by", r.optString("payment"))
        if (!r.isNull("tendered")) row(s, "Cash received", usd(r.optDouble("tendered")))
        if (!r.isNull("change")) row(s, "Change", usd(r.optDouble("change")))
        r.optString("customer").takeIf { it.isNotBlank() }?.let { row(s, "Customer", it) }

        if (!r.isNull("queueNumber")) {
            s.printText("\n", cb)
            s.setAlignment(1, cb)
            s.printText("PICKUP NUMBER\n", cb)
            s.printTextWithFont(pad3(r.optInt("queueNumber")) + "\n", null, 48f, cb)
        }

        s.setAlignment(1, cb)
        r.optString("footerNote").takeIf { it.isNotBlank() }?.let { s.printText("\n$it\n", cb) }
        s.printText("\nThank you!\n", cb)
        s.lineWrap(3, cb)
        s.cutPaper(cb)

        if (r.optBoolean("openDrawer", false)) s.openDrawer(cb)
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
                "sec" -> {
                    s.printText("\n", cb)
                    s.printText(ln.optString("a") + "\n", cb)
                }
                "row" -> {
                    val big = ln.optBoolean("big", false)
                    if (big) s.setFontSize(28f, cb)
                    row(s, ln.optString("a"), ln.optString("b"))
                    if (big) s.setFontSize(22f, cb)
                }
                "center" -> {
                    s.setAlignment(1, cb)
                    s.printText(ln.optString("a") + "\n", cb)
                    s.setAlignment(0, cb)
                }
                "left" -> s.printText(ln.optString("a") + "\n", cb)
                "sig" -> {
                    s.printText("\n", cb)
                    s.printText(ln.optString("a") + ": ______________\n", cb)
                }
            }
        }

        s.printText("\n", cb)
        s.lineWrap(3, cb)
        s.cutPaper(cb)
        if (r.optBoolean("openDrawer", false)) s.openDrawer(cb)
    }

    private fun row(s: IWoyouService, label: String, value: String) {
        s.printColumnsString(arrayOf(label, value), intArrayOf(20, 12), intArrayOf(0, 2), cb)
    }

    private fun divider() = "--------------------------------\n"
    private fun usd(v: Double) = "$" + String.format("%.2f", v)
    private fun khr(v: Long) = String.format("%,d", v) + " R"
    private fun pad3(n: Int) = n.toString().padStart(3, '0')
}
