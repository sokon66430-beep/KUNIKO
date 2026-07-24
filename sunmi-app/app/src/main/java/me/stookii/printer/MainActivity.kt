package me.stookii.printer

import android.annotation.SuppressLint
import android.app.Activity
import android.os.Bundle
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient

class MainActivity : Activity() {

    companion object {
        // The hosted Stookii app this device runs. Change to your own URL if needed.
        // `?kiosk=1` locks it permanently to the till — no Exit Till Mode, ever.
        const val WEB_URL = "https://stookii-me.onrender.com/?kiosk=1"
    }

    private lateinit var web: WebView
    private lateinit var printer: SunmiPrinter

    // Bridge exposed to the web app as window.StookiiPrinter.*
    inner class Bridge {
        @JavascriptInterface
        fun printReceipt(json: String) {
            runOnUiThread { printer.printReceipt(json) }
        }

        @JavascriptInterface
        fun printSlip(json: String) {
            runOnUiThread { printer.printSlip(json) }
        }

        @JavascriptInterface
        fun openDrawer() {
            runOnUiThread { printer.openDrawer() }
        }

        @JavascriptInterface
        fun version(): String = "2"
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        printer = SunmiPrinter(this)
        printer.bind()

        web = WebView(this)
        setContentView(web)
        window.decorView.systemUiVisibility =
            View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY

        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            cacheMode = WebSettings.LOAD_DEFAULT
            useWideViewPort = true
            loadWithOverviewMode = true
            mediaPlaybackRequiresUserGesture = false
        }
        web.addJavascriptInterface(Bridge(), "StookiiPrinter")
        web.webChromeClient = WebChromeClient()
        web.webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView?, url: String?, favicon: android.graphics.Bitmap?) {
                // Belt-and-suspenders kiosk flag in case the URL param is lost on
                // an internal redirect — Stookii also persists it to localStorage.
                view?.evaluateJavascript("window.__stookiiKiosk = true;", null)
            }
        }
        web.loadUrl(WEB_URL)
    }

    override fun onResume() {
        super.onResume()
        // Pin the screen so the till can't be swiped away to Android home. Full
        // lockdown (un-exitable without a manager) needs the device to be set as
        // the Sunmi's device-owner; without that this is Android screen-pinning.
        try {
            startLockTask()
        } catch (_: Exception) {
        }
    }

    // Ignore Back so the cashier can't back out of the till.
    override fun onBackPressed() {
    }
}
