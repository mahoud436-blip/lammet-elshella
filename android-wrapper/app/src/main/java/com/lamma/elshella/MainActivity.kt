package com.lamma.elshella

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import android.os.Bundle
import android.view.View
import android.webkit.*
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : AppCompatActivity() {

    companion object {
        // ⬇️⬇️ غيّر السطر ده للينك استضافتك (Render / Railway / سيرفرك) ⬇️⬇️
        const val REMOTE_URL = "https://YOUR-APP.onrender.com"
    }

    private lateinit var webView: WebView
    private var backPressedOnce = false

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            window.statusBarColor = Color.parseColor("#101A2B")
            window.navigationBarColor = Color.parseColor("#101A2B")
        }

        webView = findViewById(R.id.webView)

        // الحل النهائي لمشكلة "اللعبة بتخش فوق شريط الإشعارات":
        // بنحسب مساحة شريط الحالة + شريط التنقل ونعملها padding للـ WebView
        // فالمحتوى بيقف عند الحواف بدل ما يتخبى تحت الشريط (شغال على كل الموبايلات وأندرويد 15).
        val root = findViewById<View>(R.id.root)
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
            )
            webView.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }
        ViewCompat.requestApplyInsets(root)

        setupWebView()
        loadGame()
    }

    private fun isOnline(): Boolean {
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val net = cm.activeNetwork ?: return false
        val caps = cm.getNetworkCapabilities(net) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    private fun loadGame() {
        if (isOnline()) webView.loadUrl(REMOTE_URL)
        else webView.loadUrl("file:///android_asset/www/offline.html")
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            cacheMode = WebSettings.LOAD_DEFAULT
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            loadWithOverviewMode = true
            useWideViewPort = true
            mediaPlaybackRequiresUserGesture = false
        }
        webView.setBackgroundColor(Color.parseColor("#101A2B"))
        webView.webChromeClient = WebChromeClient()
        webView.webViewClient = object : WebViewClient() {
            override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
                if (request?.isForMainFrame == true) view?.loadUrl("file:///android_asset/www/offline.html")
            }
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val url = request?.url?.toString() ?: return false
                return !(url.startsWith("file://") || url.startsWith(REMOTE_URL))
            }
        }
        webView.addJavascriptInterface(Bridge(), "Android")
    }

    override fun onBackPressed() {
        if (webView.canGoBack()) { webView.goBack(); return }
        if (backPressedOnce) { super.onBackPressed(); return }
        backPressedOnce = true
        Toast.makeText(this, "اضغط تاني للخروج من اللمّة 👋", Toast.LENGTH_SHORT).show()
        webView.postDelayed({ backPressedOnce = false }, 2000)
    }

    inner class Bridge {
        @JavascriptInterface fun retry() { runOnUiThread { loadGame() } }
        @JavascriptInterface fun exitApp() { runOnUiThread { finish() } }
    }

    override fun onResume() { super.onResume(); webView.onResume() }
    override fun onPause() { super.onPause(); webView.onPause() }
    override fun onDestroy() { webView.destroy(); super.onDestroy() }
}
