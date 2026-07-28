package me.stookii.printer

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.DashPathEffect
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.Typeface
import org.json.JSONObject

/**
 * Draws the customer receipt as ONE bitmap, which is then sent to the printer in
 * a single printBitmap call.
 *
 * Why a bitmap and not printText:
 *
 *  - Khmer. A thermal head prints from its own built-in character ROM, which on
 *    this (CJK-market) device has no Khmer block — every ក would come out as a
 *    box. Worse, Khmer needs real shaping: subscript consonants stack under
 *    their base and some vowels are stored after a consonant but drawn before
 *    it. No fixed-cell character printer can do that at any font. Android can:
 *    Canvas.drawText runs the same layout engine the rest of the phone uses, so
 *    the glyphs come out shaped correctly and we hand the printer pixels.
 *
 *  - Alignment. Columns no longer depend on counting monospace characters and
 *    guessing the head's pitch — every figure is positioned by its MEASURED
 *    width, so the money columns line up whatever the text is.
 *
 * Everything is laid out twice: once with a null canvas to measure the height,
 * then again to draw into a bitmap of exactly that height. Drawing into a
 * generously tall bitmap and cropping would work too, but it wastes several
 * megabytes on a till that is also running a browser.
 */
object ReceiptCanvas {

    // An 80mm head is 576 dots across. Confirmed against the printed slips: a
    // full-width rule spans the paper and 48 body characters fit on one line.
    const val WIDTH = 576
    private const val PAD = 18f // side margin, in dots
    private const val LEFT = PAD
    private const val RIGHT = WIDTH - PAD

    // Type sizes, in dots. The body is the size an arm's-length reader can take
    // in at a glance; everything else is relative to it.
    private const val BODY = 24f
    private const val SMALL = 21f
    private const val NAME = 30f // the store's Khmer trading name
    private const val TICKET = 96f // the pickup number, readable across the shop

    // The label/value block under the title: the colon sits on a fixed column so
    // every value starts at the same x, the way a form reads.
    private const val LABEL_W = 232f

    // The money columns, given as their RIGHT edges — each figure is drawn
    // right-aligned to one of these, so decimal points line up down the slip.
    private const val COL_TOTAL = RIGHT
    private const val COL_QTY = 468f
    private const val COL_PRICE = 388f
    // How wide the Price figure itself can be. The name has to stop before the
    // price STARTS, not before its right edge.
    //
    // This was `COL_PRICE - LEFT - 12f`, which let the name run to 12 dots short
    // of 388 — while "$1.72", drawn right-aligned AT 388, begins around 333. The
    // two overlapped by roughly 45 dots and printed on top of each other:
    // "Misota Chocolate-Coated Ma$0.72". Reserving the figure's own width fixes
    // it for every line, whatever the price.
    // Wide enough for "$8888.88" at the body size, so a case price can never
    // reach back into the name either.
    private const val PRICE_W = 96f
    private const val COL_NAME_W = COL_PRICE - PRICE_W - LEFT - 10f

    // ---- Khmer labels -------------------------------------------------------
    // A Cambodian commercial invoice is read in Khmer first, English second.
    private const val KH_INVOICE = "វិក្កយបត្រ"
    private const val KH_STORE = "សាខា"
    private const val KH_DATE = "កាលបរិច្ឆេទ"
    private const val KH_CASHIER = "អ្នកគិតលុយ"
    private const val KH_TILL = "ម៉ាស៊ីនគិតលុយ"
    private const val KH_ITEM = "មុខទំនិញ"
    private const val KH_PRICE = "តម្លៃ"
    private const val KH_QTY = "ចំនួន"
    private const val KH_TOTAL = "សរុប"
    private const val KH_DISCOUNT = "បញ្ចុះតម្លៃ"
    private const val KH_RECEIVED = "ប្រាក់ទទួល"
    private const val KH_CHANGE = "ប្រាក់អាប់"
    private const val KH_VAT = "តម្លៃរួមបញ្ចូលទាំងអាករ"
    private const val KH_RATE = "អត្រាប្តូរប្រាក់"
    private const val KH_TICKET = "លេខផ្ទាំងហៅ"
    private const val KH_CANCELLED = "វិក្កយបត្រលុបចោល"
    private const val KH_CANCELLED_AT = "កាលបរិច្ឆេទលុបចោល"
    private const val KH_APPROVED_BY = "អនុម័តដោយ"
    private const val KH_REASON = "មូលហេតុ"
    private const val KH_REFUND = "សងប្រាក់វិញ"

    private fun paint(size: Float, bold: Boolean = false, align: Paint.Align = Paint.Align.LEFT): Paint {
        val p = Paint(Paint.ANTI_ALIAS_FLAG)
        p.color = Color.BLACK
        p.textSize = size
        p.textAlign = align
        // DEFAULT, not MONOSPACE: the monospace face on Android has no Khmer, so
        // asking for it would silently fall back per-character and wreck the
        // shaping. Columns are positioned by measurement, so we don't need a
        // fixed pitch anyway.
        p.typeface = Typeface.create(Typeface.DEFAULT, if (bold) Typeface.BOLD else Typeface.NORMAL)
        return p
    }

    private val body = paint(BODY)
    private val bodyBold = paint(BODY, bold = true)
    private val bodyRight = paint(BODY, align = Paint.Align.RIGHT)
    private val bodyBoldRight = paint(BODY, bold = true, align = Paint.Align.RIGHT)
    private val bodyCentre = paint(BODY, align = Paint.Align.CENTER)
    private val bodyBoldCentre = paint(BODY, bold = true, align = Paint.Align.CENTER)
    private val smallCentre = paint(SMALL, align = Paint.Align.CENTER)
    private val nameCentre = paint(NAME, bold = true, align = Paint.Align.CENTER)
    private val ticketCentre = paint(TICKET, bold = true, align = Paint.Align.CENTER)

    /**
     * Break `text` into lines that each fit `maxWidth`, splitting on spaces where
     * it can and mid-word only when a single word is too long to fit at all.
     */
    private fun wrap(text: String, p: Paint, maxWidth: Float): List<String> {
        if (text.isEmpty()) return listOf("")
        if (p.measureText(text) <= maxWidth) return listOf(text)
        val out = ArrayList<String>()
        var line = StringBuilder()
        for (word in text.split(" ")) {
            val candidate = if (line.isEmpty()) word else "$line $word"
            if (p.measureText(candidate) <= maxWidth) {
                line = StringBuilder(candidate)
                continue
            }
            if (line.isNotEmpty()) {
                out.add(line.toString())
                line = StringBuilder()
            }
            // A single word wider than the column — chop it at the measured limit.
            var rest = word
            while (p.measureText(rest) > maxWidth) {
                val n = p.breakText(rest, true, maxWidth, null).coerceAtLeast(1)
                out.add(rest.substring(0, n))
                rest = rest.substring(n)
            }
            line = StringBuilder(rest)
        }
        if (line.isNotEmpty()) out.add(line.toString())
        return out
    }

    /**
     * Lay the receipt out. With a null canvas nothing is drawn and only the
     * height is computed; with a real one it draws. Both passes run identical
     * code, so the measured height can never disagree with what gets drawn.
     */
    private fun layout(c: Canvas?, r: JSONObject, logo: Bitmap?): Int {
        val store = r.optJSONObject("store") ?: JSONObject()
        var y = PAD

        fun line(text: String, p: Paint, x: Float) {
            val fm = p.fontMetrics
            y -= fm.ascent
            c?.drawText(text, x, y, p)
            y += fm.descent + 3f
        }

        fun centre(text: String, p: Paint) = line(text, p, WIDTH / 2f)

        fun gap(dots: Float) {
            y += dots
        }

        fun rule() {
            gap(6f)
            if (c != null) {
                val p = Paint(Paint.ANTI_ALIAS_FLAG)
                p.color = Color.BLACK
                p.style = Paint.Style.STROKE
                p.strokeWidth = 2f
                p.pathEffect = DashPathEffect(floatArrayOf(7f, 6f), 0f)
                c.drawLine(LEFT, y, RIGHT, y, p)
            }
            gap(8f)
        }

        /**
         * A "label : value" row. The colon sits on a fixed column and BOTH sides
         * may wrap, so a long store name or a long label each grow downwards
         * without shifting the other's column.
         */
        fun formRow(label: String, value: String) {
            val valueX = LEFT + LABEL_W + 16f
            val labelLines = wrap(label, body, LABEL_W - 10f)
            val valueLines = wrap(value, body, RIGHT - valueX)
            val fm = body.fontMetrics
            val step = (fm.descent - fm.ascent) + 3f
            val top = y
            val rows = maxOf(labelLines.size, valueLines.size)
            for (i in 0 until rows) {
                val baseline = top + i * step - fm.ascent
                labelLines.getOrNull(i)?.let { c?.drawText(it, LEFT, baseline, body) }
                if (i == 0) c?.drawText(":", LEFT + LABEL_W, baseline, body)
                valueLines.getOrNull(i)?.let { c?.drawText(it, valueX, baseline, body) }
            }
            y = top + rows * step
        }

        /** A label on the left, a figure hard right — the totals and cash rows. */
        fun moneyRow(label: String, value: String, bold: Boolean = false) {
            val lp = if (bold) bodyBold else body
            val vp = if (bold) bodyBoldRight else bodyRight
            val fm = lp.fontMetrics
            y -= fm.ascent
            c?.drawText(label, LEFT, y, lp)
            c?.drawText(value, COL_TOTAL, y, vp)
            y += fm.descent + 3f
        }

        // ---- Header ---------------------------------------------------------
        if (logo != null) {
            val h = logo.height
            if (c != null) {
                val x = (WIDTH - logo.width) / 2f
                c.drawBitmap(logo, x, y, null)
            }
            y += h + 10f
        }
        // The Khmer trading name heads the slip; stores that have not set one
        // fall back to the English name rather than printing nothing.
        val heading = store.optString("nameKhmer").takeIf { it.isNotBlank() } ?: store.optString("name")
        if (heading.isNotBlank()) for (l in wrap(heading, nameCentre, RIGHT - LEFT)) centre(l, nameCentre)
        store.optString("vatTin").takeIf { it.isNotBlank() }?.let {
            centre("លេខអត្តសញ្ញាណកម្ម (VATTIN) :$it", smallCentre)
        }
        val addrKh = store.optJSONArray("addressKhmer")
        if (addrKh != null && addrKh.length() > 0) {
            for (i in 0 until addrKh.length()) {
                for (l in wrap(addrKh.optString(i), smallCentre, RIGHT - LEFT)) centre(l, smallCentre)
            }
        } else {
            store.optString("address").takeIf { it.isNotBlank() }?.let {
                for (l in wrap(it, smallCentre, RIGHT - LEFT)) centre(l, smallCentre)
            }
        }
        r.optString("headerNote").takeIf { it.isNotBlank() }?.let { centre(it, smallCentre) }

        // The owner's wording, or the standard title if they never changed it.
        // An explicitly BLANK title prints nothing — some stores want no
        // document heading at all.
        // A cancelled invoice is a DIFFERENT document from the sale it reverses,
        // and someone holding both must never have to read the small print to
        // tell which is which. Boxed, so it survives a bad print head too.
        val voided = r.optBoolean("cancelled", false)
        if (voided) {
            gap(10f)
            val top = y
            gap(6f)
            centre(KH_CANCELLED, bodyBoldCentre)
            centre("CANCELLED INVOICE", bodyBoldCentre)
            gap(6f)
            if (c != null) {
                val box = Paint(Paint.ANTI_ALIAS_FLAG)
                box.color = Color.BLACK
                box.style = Paint.Style.STROKE
                box.strokeWidth = 3f
                c.drawRect(LEFT, top, RIGHT, y, box)
            }
        } else {
            val title = if (r.has("invoiceTitle")) r.optString("invoiceTitle") else "$KH_INVOICE / COMMERCIAL INVOICE"
            if (title.isNotBlank()) {
                gap(10f)
                for (l in wrap(title, bodyCentre, RIGHT - LEFT)) centre(l, bodyCentre)
            }
        }
        gap(6f)

        // ---- Who / when / where --------------------------------------------
        formRow("$KH_STORE / Store", store.optString("name"))
        formRow("$KH_DATE / Date", r.optString("dateTime"))
        r.optString("cashier").takeIf { it.isNotBlank() }?.let { formRow("$KH_CASHIER / Cashier", it) }
        formRow("$KH_INVOICE / Invoice No", r.optString("invoiceNo"))
        r.optString("till").takeIf { it.isNotBlank() }?.let { formRow("$KH_TILL / Till", it) }
        // A void slip is only worth printing if it says who authorised it and
        // why — that is what an owner or an auditor comes looking for. The
        // original invoice number and date stay above, so this ties back to the
        // sale it reverses.
        if (voided) {
            r.optString("cancelledAt").takeIf { it.isNotBlank() }?.let { formRow("$KH_CANCELLED_AT / Cancelled", it) }
            r.optString("cancelledBy").takeIf { it.isNotBlank() }?.let { formRow("$KH_APPROVED_BY / Approved by", it) }
            r.optString("cancelReason").takeIf { it.isNotBlank() }?.let { formRow("$KH_REASON / Reason", it) }
        }

        // A named customer prints; an unnamed one prints nothing. A "WALK-IN"
        // banner on nearly every slip is a line of paper that tells no one
        // anything.
        r.optString("customer").takeIf { it.isNotBlank() }?.let {
            gap(4f)
            centre(it.uppercase(), bodyBoldCentre)
        }

        // ---- Items ----------------------------------------------------------
        rule()
        // Two-deck headings: Khmer over English, each sitting on its own column.
        run {
            val kh = paint(SMALL)
            val khR = paint(SMALL, align = Paint.Align.RIGHT)
            val fm = kh.fontMetrics
            y -= fm.ascent
            c?.drawText(KH_ITEM, LEFT, y, kh)
            c?.drawText(KH_PRICE, COL_PRICE, y, khR)
            c?.drawText(KH_QTY, COL_QTY, y, khR)
            c?.drawText(KH_TOTAL, COL_TOTAL, y, khR)
            y += fm.descent + 2f
            val fm2 = body.fontMetrics
            y -= fm2.ascent
            c?.drawText("Item Name", LEFT, y, body)
            c?.drawText("Price", COL_PRICE, y, bodyRight)
            c?.drawText("QTY", COL_QTY, y, bodyRight)
            c?.drawText("Total", COL_TOTAL, y, bodyRight)
            y += fm2.descent + 3f
        }
        rule()

        val items = r.optJSONArray("items")
        if (items != null) for (i in 0 until items.length()) {
            val it = items.getJSONObject(i)
            val nameLines = wrap(it.optString("name"), body, COL_NAME_W)
            val fm = body.fontMetrics
            for ((n, l) in nameLines.withIndex()) {
                y -= fm.ascent
                c?.drawText(l, LEFT, y, body)
                // The three figures ride on the FIRST line of a wrapped name, so a
                // long product name pushes nothing out of its column.
                if (n == 0) {
                    c?.drawText(usd(it.optDouble("price")), COL_PRICE, y, bodyRight)
                    c?.drawText(it.optString("qtyLabel"), COL_QTY, y, bodyRight)
                    c?.drawText(usd(it.optDouble("lineTotal")), COL_TOTAL, y, bodyRight)
                }
                y += fm.descent + 3f
            }
            // How the customer asked for it — spice level, sweetness. Indented
            // under the item in small type: it belongs to that line, and the
            // customer needs to see that what they asked for was taken down.
            it.optString("options").takeIf { o -> o.isNotBlank() }?.let { note ->
                val p = paint(SMALL)
                for (l in wrap("· $note", p, COL_NAME_W)) {
                    val fm2 = p.fontMetrics
                    y -= fm2.ascent
                    c?.drawText(l, LEFT + 14f, y, p)
                    y += fm2.descent + 2f
                }
            }
            gap(4f)
        }

        // ---- Money ----------------------------------------------------------
        // No Sub Total row: with no discount it just repeats the total one line
        // below it. Deals and discounts still print — those are the only reason
        // the total ever differs from the items.
        rule()

        val promos = r.optJSONArray("promotions")
        if (promos != null) for (i in 0 until promos.length()) {
            val p = promos.getJSONObject(i)
            moneyRow(p.optString("name"), "-" + usd(p.optDouble("discount")))
        }
        val discount = r.optDouble("discount", 0.0)
        var promoTotal = 0.0
        if (promos != null) for (i in 0 until promos.length()) {
            promoTotal += promos.getJSONObject(i).optDouble("discount")
        }
        // Only the part of the discount the promotion lines have not already
        // accounted for — otherwise a deal would be subtracted twice on paper.
        val otherOff = discount - promoTotal
        if (otherOff > 0.005) moneyRow("$KH_DISCOUNT / Discount", "-" + usd(otherOff))

        if (r.optBoolean("showVat", false)) {
            moneyRow("Subtotal (ex VAT)", usd(r.optDouble("subtotal")))
            moneyRow("VAT", usd(r.optDouble("vat")))
        }

        gap(6f)
        if (voided) {
            // Negative and relabelled: this slip records money going BACK, and a
            // positive "TOTAL" on a void would read as a sale at a glance.
            moneyRow("$KH_REFUND / REFUNDED (USD)", "- " + usd(r.optDouble("total")), bold = true)
            moneyRow("$KH_REFUND / REFUNDED (KHR)", "- " + khr(r.optLong("totalRiel")), bold = true)
        } else {
            moneyRow("$KH_TOTAL / TOTAL (USD)", usd(r.optDouble("total")), bold = true)
            moneyRow("$KH_TOTAL / TOTAL (KHR)", khr(r.optLong("totalRiel")), bold = true)
        }

        // ---- Cash -----------------------------------------------------------
        val receivedUsd = if (r.isNull("receivedUsd")) null else r.optDouble("receivedUsd")
        val receivedRiel = if (r.isNull("receivedRiel")) null else r.optLong("receivedRiel")
        val change = if (r.isNull("change")) null else r.optDouble("change")
        if (receivedUsd != null || receivedRiel != null || change != null) {
            rule()
            if (receivedUsd != null && receivedUsd > 0.005) {
                moneyRow("$KH_RECEIVED / Received (USD)", usd(receivedUsd))
            }
            if (receivedRiel != null && receivedRiel > 0) {
                moneyRow("$KH_RECEIVED / Received (KHR)", khr(receivedRiel))
            }
            if (change != null) moneyRow("$KH_CHANGE / Change Given (USD)", usd(change))
        } else {
            rule()
            moneyRow("Paid by", r.optString("payment"))
        }

        // ---- Footer notes ---------------------------------------------------
        gap(12f)
        val pct = r.optInt("vatPct", 10)
        centre("$KH_VAT /Incl. VAT $pct%", smallCentre)
        val rate = r.optInt("exchangeRate", 4100)
        centre("$KH_RATE / Exchange Rate \$1 = KHR $rate៛", smallCentre)

        // ---- Pickup number --------------------------------------------------
        if (!voided && r.optBoolean("showPickup", true) && !r.isNull("queueNumber")) {
            gap(10f)
            val codeText = r.optString("queueCode").takeIf { it.isNotBlank() }
                ?: r.optInt("queueNumber").toString().padStart(3, '0')
            centre(codeText, ticketCentre)
            centre("$KH_TICKET/TICKET", smallCentre)
        }

        r.optString("footerNote").takeIf { it.isNotBlank() }?.let {
            gap(12f)
            for (l in wrap(it, bodyBoldCentre, RIGHT - LEFT)) centre(l, bodyBoldCentre)
        }

        gap(PAD)
        return y.toInt()
    }

    /** Render the receipt described by `r` into a printable bitmap. */
    fun render(r: JSONObject, logo: Bitmap?): Bitmap {
        val h = layout(null, r, logo).coerceIn(1, 8000)
        val bmp = Bitmap.createBitmap(WIDTH, h, Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp)
        c.drawColor(Color.WHITE)
        layout(c, r, logo)
        return bmp
    }

    private fun usd(v: Double) = "$" + String.format("%.2f", v)
    private fun khr(v: Long) = "៛" + String.format("%,d", v)

    // Kept for callers that want to know how tall a rendered slip came out
    // without holding the bitmap (used only by tests / diagnostics).
    fun measure(r: JSONObject, logo: Bitmap?): Rect = Rect(0, 0, WIDTH, layout(null, r, logo))
}
