package com.mstat.piremote

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.WindowManager
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.Image
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.draw.clip
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import okhttp3.*
import okio.ByteString
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.delay
import kotlin.math.min

class MainActivity : ComponentActivity() {
    private var pendingUri by mutableStateOf<String?>(null)
    private var pendingSharedUris by mutableStateOf<List<String>>(emptyList())
    private var pendingSharedText by mutableStateOf<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        pendingUri = intent?.data?.toString()
        pendingSharedUris = extractSharedUris(intent)
        pendingSharedText = extractSharedText(intent)
        window.statusBarColor = android.graphics.Color.parseColor("#031F1B")
        window.navigationBarColor = android.graphics.Color.parseColor("#031F1B")
        setContent { PiRemoteApp(connectionUri = pendingUri, sharedUris = pendingSharedUris, sharedText = pendingSharedText) }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        pendingUri = intent.data?.toString()
        pendingSharedUris = extractSharedUris(intent)
        pendingSharedText = extractSharedText(intent)
    }

    private fun extractSharedUris(intent: Intent?): List<String> {
        if (intent == null) return emptyList()
        return when (intent.action) {
            Intent.ACTION_SEND -> listOfNotNull(intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)?.toString())
            Intent.ACTION_SEND_MULTIPLE -> intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM)
                ?.map { it.toString() }
                .orEmpty()
            else -> emptyList()
        }
    }

    private fun extractSharedText(intent: Intent?): String? {
        if (intent?.action != Intent.ACTION_SEND) return null
        return intent.getStringExtra(Intent.EXTRA_TEXT)?.takeIf { it.isNotBlank() }
    }
}

private val PiGreen = Color(0xFF10B981)
private val PiGreenDeep = Color(0xFF031F1B)
private val PiGreenDark = Color(0xFF064E3B)
private val PiGreenSoft = Color(0xFFD1FAE5)
private val PiTeal = Color(0xFF14B8A6)
private val PiAmber = Color(0xFFF59E0B)

private val PiDarkColors = darkColorScheme(
    primary = PiGreenSoft,
    onPrimary = PiGreenDeep,
    primaryContainer = PiGreenDark,
    onPrimaryContainer = Color(0xFFECFDF5),
    secondary = PiTeal,
    secondaryContainer = Color(0xFF042F2E),
    onSecondaryContainer = Color(0xFFCCFBF1),
    tertiary = PiAmber,
    tertiaryContainer = Color(0xFF5B3A09),
    onTertiaryContainer = Color(0xFFFFF7ED),
    background = PiGreenDeep,
    surface = Color(0xFF062A25),
    surfaceVariant = Color(0xFF0B332E),
    onSurface = Color(0xFFF0FDFA),
    outline = Color(0xFF8BB7AD),
    error = Color(0xFFFCA5A5),
    errorContainer = Color(0xFF7F1D1D),
    onErrorContainer = Color(0xFFFFE4E6),
)

private val PiLightColors = lightColorScheme(
    primary = Color(0xFF047857),
    onPrimary = Color.White,
    primaryContainer = Color(0xFFD1FAE5),
    onPrimaryContainer = Color(0xFF022C22),
    secondary = Color(0xFF0F766E),
    secondaryContainer = Color(0xFFCCFBF1),
    onSecondaryContainer = Color(0xFF042F2E),
    tertiary = Color(0xFFD97706),
    tertiaryContainer = Color(0xFFFEF3C7),
    onTertiaryContainer = Color(0xFF451A03),
    background = Color(0xFFF3FCF8),
    surface = Color.White,
    surfaceVariant = Color(0xFFE6F5F0),
    outline = Color(0xFF5F7F77),
)

enum class ChatKind { User, Assistant, Tool, System, Error }

data class ChatItem(
    val id: Long,
    val kind: ChatKind,
    val title: String,
    val text: String,
    val expanded: Boolean = false,
)

data class SessionCandidate(
    val host: String,
    val port: Int,
    val label: String,
    val isIdle: Boolean,
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PiRemoteApp(connectionUri: String? = null, sharedUris: List<String> = emptyList(), sharedText: String? = null) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val density = LocalDensity.current
    val prefs = remember { securePiRemotePreferences(context) }

    var host by remember { mutableStateOf(prefs.getString("host", "192.168.1.") ?: "192.168.1.") }
    var port by remember { mutableStateOf(prefs.getString("port", "37891") ?: "37891") }
    var token by remember { mutableStateOf(prefs.getString("token", "") ?: "") }
    var input by remember { mutableStateOf("") }
    val attachments = remember { mutableStateListOf<AttachmentItem>() }
    var connected by remember { mutableStateOf(false) }
    var connecting by remember { mutableStateOf(false) }
    var showSettings by remember { mutableStateOf(false) }
    var showToken by remember { mutableStateOf(false) }
    var autoSendShared by remember { mutableStateOf(prefs.getBoolean("autoSendShared", false)) }
    var keepAwake by remember { mutableStateOf(prefs.getBoolean("keepAwake", false)) }
    var pendingAutoSendShared by remember { mutableStateOf(false) }
    var scanningSessions by remember { mutableStateOf(false) }
    var showSessionPicker by remember { mutableStateOf(false) }
    val sessionCandidates = remember { mutableStateListOf<SessionCandidate>() }
    var working by remember { mutableStateOf(false) }
    var suppressNextCloseNotice by remember { mutableStateOf(false) }
    var reconnectAttempts by remember { mutableIntStateOf(0) }
    var status by remember { mutableStateOf("Disconnected") }
    var sessionInfo by remember { mutableStateOf("No session") }
    var supportsBinaryFileAttachments by remember { mutableStateOf(false) }
    var activeAssistantId by remember { mutableStateOf<Long?>(null) }
    var scrollVersion by remember { mutableIntStateOf(0) }
    var autoConnectRequest by remember { mutableIntStateOf(0) }
    val messages = remember { mutableStateListOf<ChatItem>() }
    val activeToolMessages = remember { mutableStateMapOf<String, Long>() }
    val pendingUserEchoes = remember { mutableStateListOf<String>() }
    val listState = rememberLazyListState()
    val mainHandler = remember { Handler(Looper.getMainLooper()) }
    val keyboardVisible = WindowInsets.ime.getBottom(density) > 0

    fun applyConnectionUri(uriText: String): Boolean {
        return runCatching {
            val uri = Uri.parse(uriText)
            if (uri.scheme != "pi-remote") return@runCatching false
            host = uri.host.orEmpty().ifBlank { host }
            port = uri.port.takeIf { it > 0 }?.toString() ?: port
            token = uri.getQueryParameter("token") ?: token
            prefs.edit()
                .putString("host", host.trim())
                .putString("port", port.trim().ifBlank { "37891" })
                .putString("token", token.trim())
                .apply()
            autoConnectRequest++
            true
        }.getOrDefault(false)
    }

    LaunchedEffect(connectionUri) {
        connectionUri?.let { applyConnectionUri(it) }
    }

    val client = remember {
        OkHttpClient.Builder()
            .pingInterval(20, TimeUnit.SECONDS)
            .build()
    }
    var webSocket by remember { mutableStateOf<WebSocket?>(null) }

    fun nextId() = System.nanoTime()

    fun copyText(label: String, value: String) {
        if (value.isBlank()) return
        val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        clipboard.setPrimaryClip(ClipData.newPlainText(label, value))
        Toast.makeText(context, "$label copied", Toast.LENGTH_SHORT).show()
    }

    fun latestAssistantText(): String = messages.lastOrNull { it.kind == ChatKind.Assistant }?.text.orEmpty()

    fun addMessage(kind: ChatKind, title: String, text: String) {
        messages.add(ChatItem(nextId(), kind, title, text))
        if (messages.size > 250) messages.removeRange(0, messages.size - 250)
        scrollVersion++
    }

    fun attachmentName(uri: Uri, mimeType: String): String {
        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) {
                val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (index >= 0) cursor.getString(index)?.takeIf { it.isNotBlank() }?.let { return it }
            }
        }
        return uri.lastPathSegment?.substringAfterLast('/')?.takeIf { it.isNotBlank() } ?: fallbackAttachmentName(mimeType)
    }

    fun addAttachmentFromUri(uri: Uri) {
        if (attachments.size >= 4) {
            addMessage(ChatKind.Error, "Attachment limit", "Remove an attachment before adding more.")
            return
        }
        runCatching {
            val mimeType = context.contentResolver.getType(uri) ?: "application/octet-stream"
            val name = attachmentName(uri, mimeType)
            val attachment = context.contentResolver.openInputStream(uri)?.use { stream ->
                createAttachmentForStream(name, mimeType, stream)
            } ?: return@runCatching
            attachments.add(attachment)
        }.onFailure { error ->
            val message = error.message ?: "Could not read file"
            val title = if (message.contains("larger than")) "Attachment too large" else "Attachment failed"
            addMessage(ChatKind.Error, title, message)
        }
    }

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.GetMultipleContents()) { uris ->
        for (uri in uris.take(4 - attachments.size)) addAttachmentFromUri(uri)
    }
    val qrScanner = rememberLauncherForActivityResult(ScanContract()) { result ->
        val contents = result.contents
        if (contents.isNullOrBlank()) return@rememberLauncherForActivityResult
        if (applyConnectionUri(contents)) {
            addMessage(ChatKind.System, "QR", "Connection loaded")
        } else {
            addMessage(ChatKind.Error, "QR", "Not a Pi Remote QR code")
        }
    }

    LaunchedEffect(sharedUris) {
        val parsed = sharedUris.mapNotNull { runCatching { Uri.parse(it) }.getOrNull() }
        parsed.forEach { addAttachmentFromUri(it) }
        if (parsed.isNotEmpty() && autoSendShared) {
            pendingAutoSendShared = true
            autoConnectRequest++
        }
    }

    LaunchedEffect(sharedText) {
        if (!sharedText.isNullOrBlank() && input.isBlank()) input = sharedText
        if (!sharedText.isNullOrBlank() && autoSendShared) {
            pendingAutoSendShared = true
            autoConnectRequest++
        }
    }

    fun appendAssistantDelta(delta: String) {
        if (delta.isEmpty()) return
        val id = activeAssistantId
        val index = id?.let { existingId -> messages.indexOfFirst { it.id == existingId } } ?: -1
        if (index >= 0) {
            val old = messages[index]
            messages[index] = old.copy(text = old.text + delta)
        } else {
            val newId = nextId()
            activeAssistantId = newId
            messages.add(ChatItem(newId, ChatKind.Assistant, "Assistant", delta))
        }
        scrollVersion++
    }

    fun upsertToolMessage(toolCallId: String, title: String, text: String, done: Boolean) {
        val existingId = activeToolMessages[toolCallId]
        val index = existingId?.let { id -> messages.indexOfFirst { it.id == id } } ?: -1
        if (index >= 0) {
            val old = messages[index]
            messages[index] = old.copy(title = title, text = text)
        } else {
            val newId = nextId()
            activeToolMessages[toolCallId] = newId
            messages.add(ChatItem(newId, ChatKind.Tool, title, text))
        }
        if (done) activeToolMessages.remove(toolCallId)
        scrollVersion++
    }

    fun toggleToolMessage(id: Long) {
        val index = messages.indexOfFirst { it.id == id && it.kind == ChatKind.Tool }
        if (index >= 0) messages[index] = messages[index].copy(expanded = !messages[index].expanded)
    }

    fun saveConnectionSettings() {
        prefs.edit()
            .putString("host", host.trim())
            .putString("port", port.trim().ifBlank { "37891" })
            .putString("token", token.trim())
            .apply()
    }

    fun sendJson(type: String, text: String? = null) {
        val ws = webSocket
        if (ws == null || !connected) {
            addMessage(ChatKind.Error, "Not connected", "Connect to Pi before sending commands.")
            return
        }
        if (type in listOf("prompt", "steer", "follow_up") && hasBinaryFileAttachment(attachments) && !supportsBinaryFileAttachments) {
            addMessage(ChatKind.Error, "Unsupported attachment", "This Pi Remote server does not advertise binary file attachment support. Update the Pi extension and reconnect.")
            return
        }
        val payload = runCatching { buildPromptJson(type, text, attachments).toString() }
            .onFailure { addMessage(ChatKind.Error, "Send failed", it.message ?: "Message is too large") }
            .getOrNull() ?: return
        if (!ws.send(payload)) {
            addMessage(ChatKind.Error, "Send failed", "Message is too large to queue; remove an attachment and try again.")
            return
        }

        when (type) {
            "prompt", "steer", "follow_up" -> {
                val displayedText = listOfNotNull(
                    text.orEmpty().takeIf { it.isNotBlank() },
                    attachments.takeIf { it.isNotEmpty() }?.joinToString(prefix = "Attachments: ") { it.name },
                ).joinToString("\n")
                if (displayedText.isNotBlank()) pendingUserEchoes.add(displayedText)
                if (pendingUserEchoes.size > 10) pendingUserEchoes.removeRange(0, pendingUserEchoes.size - 10)
                addMessage(
                ChatKind.User,
                type.replace('_', ' ').replaceFirstChar { it.uppercase() },
                displayedText
                )
            }
            "abort" -> addMessage(ChatKind.System, "Abort", "Abort requested")
            "get_state", "ping" -> addMessage(ChatKind.System, type, "Requested")
        }
        if (type in listOf("prompt", "steer", "follow_up")) attachments.clear()
    }

    LaunchedEffect(pendingAutoSendShared, connected, input, attachments.size) {
        if (pendingAutoSendShared && connected && (input.isNotBlank() || attachments.isNotEmpty())) {
            sendJson("prompt", input)
            input = ""
            pendingAutoSendShared = false
        }
    }

    fun connect(clearMessages: Boolean = true) {
        if (connecting) return
        if (webSocket != null) suppressNextCloseNotice = true
        webSocket?.close(1000, "Reconnect")
        if (clearMessages) {
            messages.clear()
            activeToolMessages.clear()
            activeAssistantId = null
            scrollVersion++
        }
        saveConnectionSettings()
        prefs.edit().putBoolean("autoReconnect", true).apply()
        val cleanHost = host.trim()
        val cleanPort = port.trim().ifBlank { "37891" }
        val url = Uri.Builder()
            .scheme("ws")
            .encodedAuthority("$cleanHost:${cleanPort.toIntOrNull() ?: 37891}")
            .appendQueryParameter("token", token.trim())
            .build()
            .toString()

        connecting = true
        status = "Connecting..."
        val request = Request.Builder().url(url).build()
        webSocket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                mainHandler.post {
                    connected = true
                    connecting = false
                    showSettings = false
                    working = false
                    supportsBinaryFileAttachments = false
                    status = "Connected"
                    reconnectAttempts = 0
                }
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                mainHandler.post {
                    handleIncoming(
                        text = text,
                        addMessage = ::addMessage,
                        appendAssistantDelta = ::appendAssistantDelta,
                        upsertToolMessage = ::upsertToolMessage,
                        setSessionInfo = { sessionInfo = it },
                        setWorking = { working = it },
                        setSupportsBinaryFileAttachments = { supportsBinaryFileAttachments = it },
                        clearActiveAssistant = { activeAssistantId = null },
                        suppressUserEcho = { echoedText ->
                            val index = pendingUserEchoes.indexOfFirst { it == echoedText }
                            if (index >= 0) {
                                pendingUserEchoes.removeAt(index)
                                true
                            } else {
                                false
                            }
                        },
                    )
                }
            }

            override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
                onMessage(webSocket, bytes.utf8())
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                webSocket.close(code, reason)
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                mainHandler.post {
                    connected = false
                    connecting = false
                    working = false
                    status = "Disconnected"
                    if (suppressNextCloseNotice) {
                        suppressNextCloseNotice = false
                    } else {
                        addMessage(ChatKind.System, "Disconnected", "$code $reason")
                        scheduleReconnect(
                            mainHandler,
                            reconnectAttempts++,
                            shouldAutoReconnect = { prefs.getBoolean("autoReconnect", false) && host.isNotBlank() && port.isNotBlank() && token.isNotBlank() },
                            connect = { connect(clearMessages = false) },
                            setStatus = { status = it },
                        )
                    }
                }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                mainHandler.post {
                    connected = false
                    connecting = false
                    working = false
                    status = "Error"
                    addMessage(ChatKind.Error, "Connection error", t.message ?: "Unknown error")
                    scheduleReconnect(
                        mainHandler,
                        reconnectAttempts++,
                        shouldAutoReconnect = { prefs.getBoolean("autoReconnect", false) && host.isNotBlank() && port.isNotBlank() && token.isNotBlank() },
                        connect = { connect(clearMessages = false) },
                        setStatus = { status = it },
                    )
                }
            }
        })
    }

    fun disconnect() {
        prefs.edit().putBoolean("autoReconnect", false).apply()
        webSocket?.close(1000, "Android disconnect")
        webSocket = null
        connected = false
        connecting = false
        working = false
        status = "Disconnected"
        reconnectAttempts = 0
    }

    fun shouldAutoReconnect(): Boolean =
        prefs.getBoolean("autoReconnect", false) && host.isNotBlank() && port.isNotBlank() && token.isNotBlank()

    fun scanSessions() {
        val baseHost = host.trim().ifBlank { return }
        val currentPort = port.toIntOrNull() ?: 37891
        val ports = ((currentPort - 2)..(currentPort + 8)).filter { it in 1..65535 }.distinct()
        sessionCandidates.clear()
        scanningSessions = true
        var pending = ports.size
        fun doneOne() = mainHandler.post {
            pending--
            if (pending <= 0) {
                scanningSessions = false
                showSessionPicker = true
            }
        }
        ports.forEach { scanPort ->
            var finished = false
            fun donePort() {
                if (finished) return
                finished = true
                doneOne()
            }
            val url = Uri.Builder().scheme("ws").encodedAuthority("$baseHost:$scanPort").appendQueryParameter("token", token.trim()).build().toString()
            val ws = client.newWebSocket(Request.Builder().url(url).build(), object : WebSocketListener() {
                override fun onMessage(webSocket: WebSocket, text: String) {
                    if (finished) return
                    val obj = runCatching { JSONObject(text) }.getOrNull()
                    if (obj?.optString("type") == "hello") {
                        val state = obj.optJSONObject("state")
                        val idle = state?.optBoolean("isIdle", true) ?: true
                        val model = state?.optJSONObject("model")?.optString("id").orEmpty()
                        val cwd = state?.optString("cwd").orEmpty().substringAfterLast('\\').ifBlank { state?.optString("cwd").orEmpty() }
                        mainHandler.post { sessionCandidates.add(SessionCandidate(baseHost, scanPort, "${if (idle) "Idle" else "Working"} • $model • $cwd", idle)) }
                        webSocket.close(1000, "scan complete")
                        donePort()
                    }
                }
                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) { donePort() }
                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) { donePort() }
            })
            mainHandler.postDelayed({ if (!finished) { ws.cancel(); donePort() } }, 1800)
        }
    }

    LaunchedEffect(connected, keepAwake) {
        if (connected && keepAwake) context.findActivity()?.window?.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        else context.findActivity()?.window?.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }

    LaunchedEffect(Unit) {
        if (!connected && !connecting && shouldAutoReconnect()) connect()
    }

    DisposableEffect(lifecycleOwner, connected, host, port, token) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME && !connected && !connecting && shouldAutoReconnect()) {
                connect()
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    LaunchedEffect(autoConnectRequest) {
        if (autoConnectRequest > 0 && !connected && !connecting) connect()
    }

    LaunchedEffect(scrollVersion) {
        if (messages.isNotEmpty()) {
            listState.animateScrollToItem(messages.lastIndex)
        }
    }

    MaterialTheme(colorScheme = if (isSystemInDarkTheme()) PiDarkColors else PiLightColors) {
        Scaffold(
            topBar = {
                BrandedTopBar(
                    connected = connected,
                    connecting = connecting,
                    showSettings = showSettings,
                    onConnect = { connect() },
                    onDisconnect = ::disconnect,
                    onToggleSettings = { showSettings = !showSettings },
                    onClear = {
                        messages.clear()
                        activeAssistantId = null
                        activeToolMessages.clear()
                    },
                    onCopyLatest = { copyText("Assistant", latestAssistantText()) },
                    onScanSessions = ::scanSessions,
                    scanningSessions = scanningSessions,
                )
            }
        ) { padding ->
            Column(
                modifier = Modifier
                    .padding(padding)
                    .imePadding()
                    .navigationBarsPadding()
                    .padding(12.dp)
                    .fillMaxSize(),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                StatusPanel(status = status, connected = connected, working = working, sessionInfo = sessionInfo)

                if (!keyboardVisible && (!connected || showSettings)) {
                    if (connected && showSettings) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text("Settings", style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurface)
                            TextButton(onClick = { showSettings = false }) { Text("Close") }
                        }
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                        OutlinedTextField(host, { host = it }, label = { Text("Host") }, modifier = Modifier.weight(1f), singleLine = true)
                        OutlinedTextField(port, { port = it }, label = { Text("Port") }, modifier = Modifier.width(100.dp), singleLine = true)
                    }
                    OutlinedTextField(
                        value = token,
                        onValueChange = { token = it },
                        label = { Text("Token") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                        visualTransformation = if (showToken) VisualTransformation.None else PasswordVisualTransformation(),
                        trailingIcon = {
                            TextButton(onClick = { showToken = !showToken }) { Text(if (showToken) "Hide" else "Show") }
                        },
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(onClick = { saveConnectionSettings(); addMessage(ChatKind.System, "Saved", "Connection settings saved") }) { Text("Save") }
                        OutlinedButton(onClick = {
                            qrScanner.launch(
                                ScanOptions()
                                    .setDesiredBarcodeFormats(ScanOptions.QR_CODE)
                                    .setPrompt("Scan Pi Remote QR")
                                    .setBeepEnabled(false)
                                    .setOrientationLocked(false)
                            )
                        }) { Text("Scan QR") }
                    }
                    SettingsSwitchRow(
                        title = "Auto-send shared content",
                        subtitle = "When opened from Android Share",
                        checked = autoSendShared,
                        onCheckedChange = {
                            autoSendShared = it
                            prefs.edit().putBoolean("autoSendShared", it).apply()
                        },
                    )
                    SettingsSwitchRow(
                        title = "Keep screen awake",
                        subtitle = "While connected",
                        checked = keepAwake,
                        onCheckedChange = {
                            keepAwake = it
                            prefs.edit().putBoolean("keepAwake", it).apply()
                        },
                    )
                }

                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .weight(1f),
                ) {
                    if (messages.isEmpty()) {
                        EmptyState(
                            text = if (working) "Waiting for Pi output…" else "Output will appear here",
                            modifier = Modifier.align(Alignment.Center),
                        )
                    }
                    LazyColumn(
                        state = listState,
                        modifier = Modifier.fillMaxSize(),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                        contentPadding = PaddingValues(end = 10.dp),
                    ) {
                        items(messages, key = { it.id }) { item ->
                            ChatCard(
                                item = item,
                                onToggleTool = { toggleToolMessage(item.id) },
                                onCopy = { copyText(item.title, item.text) },
                            )
                        }
                    }
                    OutputScrollbar(
                        listState = listState,
                        itemCount = messages.size,
                        modifier = Modifier
                            .align(Alignment.CenterEnd)
                            .fillMaxHeight()
                            .width(6.dp),
                    )
                }

                if (scanningSessions) {
                    ScanningSessionsDialog()
                }

                if (showSessionPicker) {
                    SessionPickerDialog(
                        candidates = sessionCandidates.sortedWith(compareBy<SessionCandidate> { it.isIdle }.thenBy { it.port }),
                        onDismiss = { showSessionPicker = false },
                        onPick = { candidate ->
                            host = candidate.host
                            port = candidate.port.toString()
                            saveConnectionSettings()
                            showSessionPicker = false
                            connect()
                        },
                    )
                }

                ComposerPanel(
                    input = input,
                    onInputChange = { input = it },
                    attachments = attachments,
                    connected = connected,
                    working = working,
                    keyboardVisible = keyboardVisible,
                    onSend = { type ->
                        sendJson(type, input)
                        input = ""
                    },
                    onAttach = { picker.launch("*/*") },
                    onClearAttachments = { attachments.clear() },
                    onRemoveAttachment = { attachment -> attachments.remove(attachment) },
                    onAbort = { sendJson("abort") },
                )
            }
        }
    }

    DisposableEffect(Unit) {
        onDispose {
            webSocket?.close(1000, "Activity disposed")
            client.dispatcher.executorService.shutdown()
        }
    }
}

private fun scheduleReconnect(
    handler: Handler,
    attempt: Int,
    shouldAutoReconnect: () -> Boolean,
    connect: () -> Unit,
    setStatus: (String) -> Unit,
) {
    if (!shouldAutoReconnect()) return
    val delayMs = min(30_000L, 1_000L * (1L shl attempt.coerceIn(0, 5)))
    setStatus("Reconnecting in ${delayMs / 1000}s…")
    handler.postDelayed({
        if (shouldAutoReconnect()) {
            setStatus("Reconnecting…")
            connect()
        }
    }, delayMs)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun BrandedTopBar(
    connected: Boolean,
    connecting: Boolean,
    showSettings: Boolean,
    onConnect: () -> Unit,
    onDisconnect: () -> Unit,
    onToggleSettings: () -> Unit,
    onClear: () -> Unit,
    onCopyLatest: () -> Unit,
    onScanSessions: () -> Unit,
    scanningSessions: Boolean,
) {
    var menuOpen by remember { mutableStateOf(false) }
    TopAppBar(
        title = {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Box(
                    modifier = Modifier
                        .size(34.dp)
                        .clip(RoundedCornerShape(11.dp))
                        .background(Brush.linearGradient(listOf(PiGreenDark, PiTeal))),
                    contentAlignment = Alignment.Center,
                ) {
                    Image(
                        painter = painterResource(id = R.drawable.ic_pi_remote),
                        contentDescription = null,
                        modifier = Modifier.size(30.dp),
                    )
                }
                Column {
                    Text("π Remote", style = MaterialTheme.typography.titleLarge)
                    Text("Live Pi session control", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.outline)
                }
            }
        },
        actions = {
            Box {
                TextButton(onClick = { menuOpen = true }) { Text("☰", style = MaterialTheme.typography.titleLarge) }
                DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                    if (connected) {
                        DropdownMenuItem(text = { Text("Disconnect") }, onClick = { menuOpen = false; onDisconnect() })
                    } else {
                        DropdownMenuItem(
                            text = { Text(if (connecting) "Connecting…" else "Connect") },
                            enabled = !connecting,
                            onClick = { menuOpen = false; onConnect() },
                        )
                    }
                    DropdownMenuItem(
                        text = { Text(if (showSettings) "Hide settings" else "Settings") },
                        onClick = { menuOpen = false; onToggleSettings() },
                    )
                    DropdownMenuItem(
                        text = { Text(if (scanningSessions) "Scanning…" else "Sessions") },
                        enabled = !scanningSessions,
                        onClick = { menuOpen = false; onScanSessions() },
                    )
                    DropdownMenuItem(text = { Text("Copy latest response") }, onClick = { menuOpen = false; onCopyLatest() })
                    DropdownMenuItem(text = { Text("Clear output") }, onClick = { menuOpen = false; onClear() })
                }
            }
        },
        colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
    )
}

@Composable
private fun SettingsSwitchRow(
    title: String,
    subtitle: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyLarge)
            Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
        }
        Switch(checked = checked, onCheckedChange = onCheckedChange)
    }
}

@Composable
private fun ScanningSessionsDialog() {
    AlertDialog(
        onDismissRequest = {},
        title = { Text("Scanning sessions") },
        text = {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                CircularProgressIndicator(modifier = Modifier.size(24.dp), strokeWidth = 3.dp)
                Text("Checking nearby Pi Remote ports…")
            }
        },
        confirmButton = {},
    )
}

@Composable
private fun SessionPickerDialog(
    candidates: List<SessionCandidate>,
    onDismiss: () -> Unit,
    onPick: (SessionCandidate) -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Pi sessions") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (candidates.isEmpty()) {
                    Text("No sessions found nearby. Check host/token and try again.")
                } else {
                    candidates.forEach { candidate ->
                        ElevatedCard(
                            modifier = Modifier.fillMaxWidth().clickable { onPick(candidate) },
                            colors = CardDefaults.elevatedCardColors(
                                containerColor = if (candidate.isIdle) MaterialTheme.colorScheme.surfaceVariant else MaterialTheme.colorScheme.secondaryContainer,
                            ),
                        ) {
                            Column(Modifier.padding(12.dp)) {
                                Text("${candidate.host}:${candidate.port}", style = MaterialTheme.typography.titleSmall)
                                Text(candidate.label, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            }
                        }
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("Close") } },
    )
}

@Composable
private fun EmptyState(text: String, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier,
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(
            modifier = Modifier
                .size(82.dp)
                .clip(RoundedCornerShape(24.dp))
                .background(MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.65f)),
            contentAlignment = Alignment.Center,
        ) {
            Image(
                painter = painterResource(id = R.drawable.ic_pi_remote),
                contentDescription = null,
                modifier = Modifier.size(68.dp),
            )
        }
        Text(
            text,
            color = MaterialTheme.colorScheme.outline,
            style = MaterialTheme.typography.bodyLarge,
        )
    }
}

@Composable
private fun OutputScrollbar(
    listState: androidx.compose.foundation.lazy.LazyListState,
    itemCount: Int,
    modifier: Modifier = Modifier,
) {
    if (itemCount <= 1) return

    val visibleCount = listState.layoutInfo.visibleItemsInfo.size.coerceAtLeast(1)
    if (visibleCount >= itemCount) return

    val firstVisible = listState.firstVisibleItemIndex
    val thumbFraction = (visibleCount.toFloat() / itemCount.toFloat()).coerceIn(0.08f, 1f)
    val maxFirst = (itemCount - visibleCount).coerceAtLeast(1)
    val offsetFraction = (firstVisible.toFloat() / maxFirst.toFloat()).coerceIn(0f, 1f)
    val color = MaterialTheme.colorScheme.primary.copy(alpha = 0.65f)
    val trackColor = MaterialTheme.colorScheme.outline.copy(alpha = 0.18f)

    Canvas(modifier = modifier) {
        val trackWidth = size.width
        drawRoundRect(
            color = trackColor,
            size = androidx.compose.ui.geometry.Size(trackWidth, size.height),
            cornerRadius = androidx.compose.ui.geometry.CornerRadius(trackWidth / 2, trackWidth / 2),
        )
        val thumbHeight = size.height * thumbFraction
        val thumbTop = (size.height - thumbHeight) * offsetFraction
        drawRoundRect(
            color = color,
            topLeft = androidx.compose.ui.geometry.Offset(0f, thumbTop),
            size = androidx.compose.ui.geometry.Size(trackWidth, thumbHeight),
            cornerRadius = androidx.compose.ui.geometry.CornerRadius(trackWidth / 2, trackWidth / 2),
        )
    }
}

@Composable
private fun ComposerPanel(
    input: String,
    onInputChange: (String) -> Unit,
    attachments: List<AttachmentItem>,
    connected: Boolean,
    working: Boolean,
    keyboardVisible: Boolean,
    onSend: (String) -> Unit,
    onAttach: () -> Unit,
    onClearAttachments: () -> Unit,
    onRemoveAttachment: (AttachmentItem) -> Unit,
    onAbort: () -> Unit,
) {
    val haptics = LocalHapticFeedback.current
    val modes = listOf("prompt" to "Ask", "steer" to "Steer", "follow_up" to "Follow")
    var selectedMode by remember { mutableStateOf("prompt") }
    var confirmAbort by remember { mutableStateOf(false) }
    val canSend = connected && (input.isNotBlank() || attachments.isNotEmpty())
    var sentPulse by remember { mutableStateOf(false) }
    val sendEnabled = canSend && !sentPulse
    fun sendWithPulse(type: String = selectedMode) {
        if (!sendEnabled) return
        haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
        sentPulse = true
        onSend(type)
    }
    LaunchedEffect(sentPulse) {
        if (sentPulse) {
            delay(350)
            sentPulse = false
        }
    }
    ElevatedCard(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.elevatedCardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.62f)),
        shape = RoundedCornerShape(22.dp),
        elevation = CardDefaults.elevatedCardElevation(defaultElevation = 2.dp),
    ) {
        Column(
            modifier = Modifier.padding(8.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            if (attachments.isNotEmpty()) {
                AttachmentChips(attachments = attachments, onRemove = onRemoveAttachment)
            }

            OutlinedTextField(
                value = input,
                onValueChange = onInputChange,
                placeholder = { Text(if (connected) "Message Pi…" else "Connect to send…") },
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = if (keyboardVisible) 60.dp else 64.dp),
                minLines = 1,
                maxLines = if (keyboardVisible) 3 else 4,
                shape = RoundedCornerShape(18.dp),
                trailingIcon = {
                    Button(
                        onClick = { sendWithPulse() },
                        enabled = sendEnabled,
                        modifier = Modifier.padding(end = 8.dp),
                        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp),
                        shape = RoundedCornerShape(999.dp),
                    ) { Text(if (sentPulse) "Sent" else "Send") }
                },
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                keyboardActions = KeyboardActions(onSend = { if (sendEnabled) sendWithPulse() }),
            )

            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.fillMaxWidth()) {
                    OutlinedButton(
                        onClick = { haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove); onAttach() },
                        enabled = attachments.size < 4,
                        modifier = Modifier.weight(1.05f).height(38.dp),
                        contentPadding = PaddingValues(horizontal = 4.dp, vertical = 2.dp),
                    ) { Text("＋ File", maxLines = 1, style = MaterialTheme.typography.labelMedium) }
                    modes.forEach { (value, label) ->
                        FilterChip(
                            selected = selectedMode == value,
                            onClick = { selectedMode = value; haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove) },
                            label = { Text(label, style = MaterialTheme.typography.labelMedium) },
                            modifier = Modifier.weight(if (value == "follow_up") 1.15f else 0.9f).height(38.dp),
                        )
                    }
                    Button(
                        onClick = { confirmAbort = true },
                        enabled = connected && working,
                        modifier = Modifier.weight(0.95f).height(38.dp),
                        contentPadding = PaddingValues(horizontal = 4.dp, vertical = 2.dp),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = MaterialTheme.colorScheme.error,
                            contentColor = MaterialTheme.colorScheme.onError,
                        ),
                    ) { Text("Abort", maxLines = 1, style = MaterialTheme.typography.labelMedium) }
                }
        }
    }
    if (confirmAbort) {
        AlertDialog(
            onDismissRequest = { confirmAbort = false },
            title = { Text("Abort current run?") },
            text = { Text("This stops the active Pi response/tool run.") },
            dismissButton = { TextButton(onClick = { confirmAbort = false }) { Text("Cancel") } },
            confirmButton = {
                Button(
                    onClick = {
                        haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                        confirmAbort = false
                        onAbort()
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error, contentColor = MaterialTheme.colorScheme.onError),
                ) { Text("Abort") }
            },
        )
    }
}

@Composable
private fun AttachmentChips(
    attachments: List<AttachmentItem>,
    onRemove: (AttachmentItem) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        attachments.forEach { attachment ->
            AssistChip(
                onClick = { onRemove(attachment) },
                label = {
                    Text(
                        attachment.chipLabel,
                        maxLines = 1,
                    )
                },
                trailingIcon = { Text("×") },
            )
        }
    }
}

@Composable
private fun StatusPanel(status: String, connected: Boolean, working: Boolean, sessionInfo: String) {
    val gradient = when {
        connected && working -> listOf(PiGreenDark, Color(0xFF0F766E))
        connected -> listOf(Color(0xFF064E3B), MaterialTheme.colorScheme.primaryContainer)
        else -> listOf(MaterialTheme.colorScheme.errorContainer, Color(0xFF991B1B))
    }
    val content = if (connected) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onErrorContainer
    val title = when {
        working -> "Working…"
        connected -> "Connected"
        else -> status
    }
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(Brush.linearGradient(gradient))
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Box(
            modifier = Modifier
                .size(10.dp)
                .clip(RoundedCornerShape(999.dp))
                .background(if (connected) PiGreen else MaterialTheme.colorScheme.error),
        )
        Column(modifier = Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(title, color = content, style = MaterialTheme.typography.titleMedium, maxLines = 1)
                val nickname = sessionNickname(sessionInfo)
                if (nickname.isNotBlank()) {
                    Surface(
                        color = Color.White.copy(alpha = 0.14f),
                        shape = RoundedCornerShape(999.dp),
                    ) {
                        Text(nickname, modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp), color = content, style = MaterialTheme.typography.labelSmall)
                    }
                }
            }
            Text(
                sessionInfo,
                color = content.copy(alpha = 0.85f),
                style = MaterialTheme.typography.bodySmall,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        if (working) {
            CircularProgressIndicator(
                modifier = Modifier.size(18.dp),
                strokeWidth = 2.dp,
                color = content,
            )
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)
@Composable
private fun ChatCard(item: ChatItem, onToggleTool: () -> Unit, onCopy: () -> Unit) {
    val colors = when (item.kind) {
        ChatKind.User -> CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer)
        ChatKind.Assistant -> CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.92f))
        ChatKind.Tool -> CardDefaults.cardColors(containerColor = toolContainerColor(item))
        ChatKind.System -> CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface.copy(alpha = 0.82f))
        ChatKind.Error -> CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer)
    }
    val align = if (item.kind == ChatKind.User) Alignment.CenterEnd else Alignment.CenterStart
    val shape = RoundedCornerShape(
        topStart = if (item.kind == ChatKind.User) 18.dp else 6.dp,
        topEnd = if (item.kind == ChatKind.User) 6.dp else 18.dp,
        bottomStart = 18.dp,
        bottomEnd = 18.dp,
    )
    Box(modifier = Modifier.fillMaxWidth(), contentAlignment = align) {
        ElevatedCard(
            modifier = Modifier
                .fillMaxWidth(if (item.kind == ChatKind.User) 0.92f else 1f)
                .combinedClickable(
                    onClick = { if (item.kind == ChatKind.Tool) onToggleTool() },
                    onLongClick = onCopy,
                ),
            colors = colors,
            shape = shape,
            elevation = CardDefaults.elevatedCardElevation(defaultElevation = if (item.kind == ChatKind.User) 3.dp else 1.dp),
        ) {
            Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                Text(
                    toolTitle(item),
                    style = MaterialTheme.typography.labelLarge,
                    color = when (item.kind) {
                        ChatKind.User -> MaterialTheme.colorScheme.onSecondaryContainer
                        ChatKind.Tool -> MaterialTheme.colorScheme.onTertiaryContainer
                        ChatKind.Error -> MaterialTheme.colorScheme.onErrorContainer
                        else -> MaterialTheme.colorScheme.primary
                    },
                )
                Text(
                    item.text.ifBlank { "…" },
                    style = MaterialTheme.typography.bodyMedium,
                    fontFamily = if (item.kind == ChatKind.Tool) FontFamily.Monospace else FontFamily.Default,
                    maxLines = if (item.kind == ChatKind.Tool && !item.expanded) 3 else Int.MAX_VALUE,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

@Composable
private fun toolContainerColor(item: ChatItem): Color {
    return when {
        item.title.contains("failed", ignoreCase = true) -> MaterialTheme.colorScheme.errorContainer.copy(alpha = 0.9f)
        item.title.contains("running", ignoreCase = true) -> MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.82f)
        else -> MaterialTheme.colorScheme.secondaryContainer.copy(alpha = 0.72f)
    }
}

private fun sessionNickname(sessionInfo: String): String {
    val candidate = sessionInfo.substringAfterLast('•', "").trim()
    return candidate.substringAfterLast('\\').substringAfterLast('/').take(18)
}

private fun toolTitle(item: ChatItem): String {
    if (item.kind != ChatKind.Tool) return when (item.kind) {
        ChatKind.User -> "You"
        ChatKind.Assistant -> "Assistant"
        ChatKind.System -> "System"
        ChatKind.Error -> "Error"
        ChatKind.Tool -> item.title
    }
    val icon = when {
        item.title.contains("running", ignoreCase = true) -> "●"
        item.title.contains("failed", ignoreCase = true) -> "⚠"
        else -> "✓"
    }
    return if (item.expanded) "$icon ${item.title}" else "$icon ${item.title}  · tap to expand"
}

private fun handleIncoming(
    text: String,
    addMessage: (ChatKind, String, String) -> Unit,
    appendAssistantDelta: (String) -> Unit,
    upsertToolMessage: (String, String, String, Boolean) -> Unit,
    setSessionInfo: (String) -> Unit,
    setWorking: (Boolean) -> Unit,
    setSupportsBinaryFileAttachments: (Boolean) -> Unit = {},
    clearActiveAssistant: () -> Unit,
    suppressUserEcho: (String) -> Boolean,
) {
    try {
        val obj = JSONObject(text)
        when (obj.optString("type")) {
            "hello" -> {
                val state = obj.optJSONObject("state")
                val capabilities = obj.optJSONObject("capabilities")
                setSupportsBinaryFileAttachments(obj.optInt("protocolVersion", 1) >= 2 || capabilities?.optBoolean("binaryFileAttachments", false) == true)
                setWorking(!(state?.optBoolean("isIdle", true) ?: true))
                setSessionInfo(describeState(state))
            }
            "user_message" -> {
                val message = obj.optJSONObject("message")
                val textContent = extractMessageText(message)
                if (textContent.isNotBlank() && !suppressUserEcho(textContent)) addMessage(ChatKind.User, "User", textContent)
            }
            "history" -> {
                val history = obj.optJSONArray("messages")
                if (history != null) {
                    for (i in 0 until history.length()) {
                        val message = history.optJSONObject(i) ?: continue
                        val role = message.optString("role")
                        val textContent = extractMessageText(message)
                        if (textContent.isBlank()) continue
                        when (role) {
                            "user" -> addMessage(ChatKind.User, "User", textContent)
                            "assistant" -> addMessage(ChatKind.Assistant, "Assistant", textContent)
                        }
                    }
                }
                obj.optJSONObject("state")?.let {
                    setWorking(!it.optBoolean("isIdle", true))
                    setSessionInfo(describeState(it))
                }
            }
            "assistant_delta" -> appendAssistantDelta(obj.optString("text"))
            "thinking_delta" -> Unit
            "tool_start" -> {
                val toolName = obj.optString("toolName")
                val toolCallId = obj.optString("toolCallId", "tool-${System.nanoTime()}")
                val command = obj.optJSONObject("args")?.optString("command", "").orEmpty()
                val summary = if (command.isNotBlank()) command.lineSequence().first().take(90) else "Running…"
                upsertToolMessage(toolCallId, "$toolName running…", summary, false)
            }
            "tool_update" -> Unit
            "tool_end" -> {
                val toolName = obj.optString("toolName")
                val toolCallId = obj.optString("toolCallId", "tool-${System.nanoTime()}")
                upsertToolMessage(toolCallId, "$toolName ${if (obj.optBoolean("isError")) "failed" else "finished"}", if (obj.optBoolean("isError")) "Error" else "OK", true)
            }
            "agent_start" -> {
                obj.optJSONObject("state")?.let { setSessionInfo(describeState(it)) }
                setWorking(true)
                clearActiveAssistant()
            }
            "agent_end" -> {
                obj.optJSONObject("state")?.let { setSessionInfo(describeState(it)) }
                setWorking(false)
                clearActiveAssistant()
            }
            "assistant_message" -> Unit
            "tool_call" -> Unit
            "session_start" -> obj.optJSONObject("state")?.let { setSessionInfo(describeState(it)) }
            "session_shutdown" -> Unit
            "queue_update" -> Unit
            "response" -> {
                val data = obj.optJSONObject("data")
                if (data?.has("cwd") == true || data?.has("state") == true) {
                    val state = data.optJSONObject("state") ?: data
                    setWorking(!state.optBoolean("isIdle", true))
                    setSessionInfo(describeState(state))
                }
                if (!obj.optBoolean("success")) addMessage(ChatKind.Error, "Command failed", obj.optString("error"))
            }
            "error" -> addMessage(ChatKind.Error, "Remote error", obj.optString("error"))
            "client_count" -> Unit
            else -> {
                val eventType = obj.optString("type", "Event")
                if (eventType == "user_message") {
                    val message = obj.optJSONObject("message")
                    val textContent = extractMessageText(message)
                    if (textContent.isNotBlank() && !suppressUserEcho(textContent)) addMessage(ChatKind.User, "User", textContent)
                } else if (eventType != "session_shutdown") {
                    addMessage(ChatKind.System, eventType, summarizeRawEvent(obj))
                }
            }
        }
    } catch (_: Exception) {
        addMessage(ChatKind.System, "Raw event", text)
    }
}

private fun summarizeRawEvent(obj: JSONObject): String {
    return when (obj.optString("type")) {
        "assistant_message" -> "Assistant message received"
        "tool_call" -> "Tool call received"
        else -> obj.toString().take(500)
    }
}

private fun extractMessageText(message: JSONObject?): String {
    if (message == null) return ""
    val content = message.opt("content") ?: return ""
    return when (content) {
        is String -> content
        is JSONArray -> buildString {
            for (i in 0 until content.length()) {
                val item = content.optJSONObject(i) ?: continue
                when (item.optString("type")) {
                    "text" -> {
                        if (isNotEmpty()) append("\n")
                        append(item.optString("text"))
                    }
                    "image" -> {
                        if (isNotEmpty()) append("\n")
                        append("[image]")
                    }
                }
            }
        }
        else -> ""
    }
}

private tailrec fun Context.findActivity(): android.app.Activity? = when (this) {
    is android.app.Activity -> this
    is android.content.ContextWrapper -> baseContext.findActivity()
    else -> null
}

private fun describeState(state: JSONObject?): String {
    if (state == null) return "No session state"
    val cwd = state.optString("cwd", "")
    val idle = state.optBoolean("isIdle", true)
    val model = state.optJSONObject("model")
    val modelText = if (model != null) "${model.optString("provider")}/${model.optString("id")}" else "unknown model"
    return listOf(
        if (idle) "Idle" else "Working",
        modelText,
        cwd,
    ).filter { it.isNotBlank() }.joinToString(" • ")
}
