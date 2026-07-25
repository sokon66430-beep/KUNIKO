package me.stookii.printer

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.hardware.display.DisplayManager
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
        // The customer-facing page shown on the T3's SECOND screen (same origin,
        // so it shares the login + localStorage the till writes the sale to).
        const val CD_URL = "https://stookii-me.onrender.com/customer-display"
    }

    private lateinit var web: WebView
    private lateinit var printer: SunmiPrinter

    // The customer view on the second screen (null when there's no second screen).
    private var displayManager: DisplayManager? = null
    private var customerPresentation: CustomerDisplayPresentation? = null

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
        fun version(): String = "5"
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

        // Watch for the customer (second) screen connecting/disconnecting so the
        // customer view follows it — no manual setup on the T3.
        displayManager = (getSystemService(Context.DISPLAY_SERVICE) as DisplayManager).also {
            it.registerDisplayListener(displayListener, null)
        }
    }

    // Show (or refresh) the customer view on the T3's second screen, if one is
    // attached. A "presentation" display is exactly the customer-facing panel.
    private fun showCustomerScreen() {
        val dm = displayManager ?: return
        val second = dm.getDisplays(DisplayManager.DISPLAY_CATEGORY_PRESENTATION).firstOrNull()
        if (second == null) {
            customerPresentation?.dismiss()
            customerPresentation = null
            return
        }
        // Already up on this exact screen — leave it (don't reload every resume).
        if (customerPresentation?.display?.displayId == second.displayId && customerPresentation?.isShowing == true) return
        customerPresentation?.dismiss()
        try {
            customerPresentation = CustomerDisplayPresentation(this, second).apply { show() }
        } catch (_: Exception) {
            customerPresentation = null
        }
    }

    private val displayListener = object : DisplayManager.DisplayListener {
        override fun onDisplayAdded(displayId: Int) = runOnUiThread { showCustomerScreen() }
        override fun onDisplayRemoved(displayId: Int) = runOnUiThread { showCustomerScreen() }
        override fun onDisplayChanged(displayId: Int) {}
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
        // Bring the customer screen up now the window is attached (Presentations
        // can only show once the host activity is on screen).
        showCustomerScreen()
    }

    override fun onDestroy() {
        super.onDestroy()
        customerPresentation?.dismiss()
        customerPresentation = null
        try {
            displayManager?.unregisterDisplayListener(displayListener)
        } catch (_: Exception) {
        }
    }

    // Ignore Back so the cashier can't back out of the till.
    override fun onBackPressed() {
    }
}
