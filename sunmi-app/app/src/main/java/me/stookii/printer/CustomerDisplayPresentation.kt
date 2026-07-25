package me.stookii.printer

import android.annotation.SuppressLint
import android.app.Presentation
import android.content.Context
import android.os.Bundle
import android.view.Display
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient

/**
 * The customer-facing view on the Sunmi T3's SECOND screen.
 *
 * It's a second WebView pointed at Stookii's /customer-display page. Because it
 * runs in the SAME app as the till WebView, it shares the cookie store (so the
 * page's /api/business fetch is authenticated) and the localStorage partition —
 * which is how the live sale crosses over: the till writes the current sale to
 * localStorage, and /customer-display reads + polls it and mirrors it here.
 *
 * A Presentation draws on a specific Display, so the customer sees the mirrored
 * sale while the cashier keeps the full till on the main screen.
 */
class CustomerDisplayPresentation(context: Context, display: Display) : Presentation(context, display) {

    private lateinit var web: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        web = WebView(context)
        setContentView(web)
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            cacheMode = WebSettings.LOAD_DEFAULT
            useWideViewPort = true
            loadWithOverviewMode = true
            mediaPlaybackRequiresUserGesture = false
        }
        web.webViewClient = WebViewClient()
        web.loadUrl(MainActivity.CD_URL)
    }
}
