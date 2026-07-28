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
     * Print the customer receipt described by the JSON payload from Stookii.
     * The layout lives in ReceiptCanvas; this only decodes the logo, hands the
     * rendered image to the head, cuts, and pops the drawer on a cash sale.
     *
     * A render failure prints nothing rather than half a receipt — the sale is
     * already recorded, and a torn-off fragment is worse than no slip.
     */
    fun printReceipt(json: String) = run { s ->
        val r = JSONObject(json)
        // The whole slip is drawn as one image and sent in a single call — see
        // ReceiptCanvas for why (Khmer needs real text shaping, which a thermal
        // head's built-in font cannot do).
        val logo = r.optString("logo").takeIf { it.isNotBlank() }?.let { decodeLogo(it) }
        val bmp = try {
            ReceiptCanvas.render(r, logo)
        } catch (_: Exception) {
            null
        }
        s.setAlignment(1, cb)
        if (bmp != null) {
            try {
                s.printBitmap(bmp, cb)
            } catch (_: Exception) {
            }
        }
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
            // The head is 576 dots wide (80mm). A logo printed anywhere near that
            // dominates the slip — the ON MART mark was taller than the whole
            // items table. 200 dots is roughly a third of the paper: a mark, not
            // a poster. Scale down only, never up (blowing a small logo up just
            // prints its pixels).
            val maxW = 200
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
                "sec" -> s.printText(line(ln.optString("a")), cb)
                // Every data row prints at the one BODY font so the value column
                // lines up on every row. (The old `big` rows jumped to a larger
                // font, which pushed their values out of the column.)
                "row" -> row(s, ln.optString("a"), ln.optString("b"))
                "center" -> {
                    s.setAlignment(1, cb)
                    s.printText(ln.optString("a") + "\n", cb)
                    s.setAlignment(0, cb)
                }
                "left" -> s.printText(line(ln.optString("a")), cb)
                // Signature line — no blank line before it; the label + underscores
                // are one line you sign on, so consecutive lines are fine.
                "sig" -> s.printText(line(ln.optString("a") + ": ______________"), cb)
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

    // Cash/till SLIPS still print as printer text: they are internal documents in
    // English only, so they don't need the bitmap treatment the customer receipt
    // gets, and text prints faster.
    //
    // This 80mm head prints ~48 monospace chars per line at the body font size.
    // Build a two-column line by padding the gap between label and value so the
    // value sits flush right — reliable printText, no printColumnsString.
    private val PAPER = 48
    // Content is inset from BOTH paper edges instead of running into them: the
    // slip reads as a page with margins rather than text bleeding off the sides,
    // and a slightly-off cut or a worn head never clips a figure. Everything —
    // rules included — is built at WIDTH and printed behind MARGIN, so the whole
    // body shares one left edge and one right edge.
    private val MARGIN = "  "
    private val WIDTH = PAPER - MARGIN.length * 2
    private fun col2(left: String, right: String): String = MARGIN + pad2(left, right, WIDTH)

    /** Left text, right text, padded apart to fill `width` characters. */
    private fun pad2(left: String, right: String, width: Int): String {
        val maxLeft = (width - right.length - 1).coerceAtLeast(0)
        val l = if (left.length > maxLeft) left.substring(0, maxLeft) else left
        val gap = (width - l.length - right.length).coerceAtLeast(1)
        return l + " ".repeat(gap) + right + "\n"
    }

    /** A plain left-aligned body line, sharing the margin with everything else. */
    private fun line(text: String) = MARGIN + text + "\n"

    // A CONTINUOUS rule, not a row of dashes. U+2500 (─) is a box-drawing
    // character whose glyph spans the full character cell, so repeating it
    // prints one unbroken line at mid-height; "-" leaves a visible gap between
    // every dash and reads as a dotted line on paper.
    //
    // The T3 is a CJK-market device with the box-drawing range in its font, so
    // this renders. If a future printer ever prints boxes instead, "_" is the
    // safe ASCII fallback — it also joins into a solid line, just at the
    // baseline rather than mid-height.
    private fun divider() = MARGIN + "─".repeat(WIDTH) + "\n"
}
