package io.github.gregorgregor25.t1arc.glucosedisplay

import android.content.Context
import android.content.res.Configuration
import android.graphics.*
import android.text.Layout
import android.text.StaticLayout
import android.text.TextPaint
import org.json.JSONObject
import java.util.Locale
import kotlin.math.*

internal data class WidgetCardImage(val bitmap: Bitmap, val description: String, val details: RectF?)

/** Native rendering of CurrentGlucoseCard; design tokens are shared with React Native.
 * Bitmap pixels are bounded independently of device density and launcher resize options.
 */
internal object GlucoseWidgetCard {
  private const val ON_BOARD_ROW_HEIGHT = 22f
  private val assets = mutableMapOf<String, JSONObject>()
  @Synchronized private fun asset(context: Context, name: String): JSONObject =
    assets.getOrPut(name) { JSONObject(context.assets.open(name).bufferedReader().use { it.readText() }) }

  fun age(timestamp: Long, now: Long, locale: Locale): String {
    fun n(value: Long) = RegionalNumberFormatter.integer(value, locale)
    val future = timestamp - now > 120_000L
    val minutes = if (future) ceil((timestamp - now) / 60_000.0).toLong() else max(0, (now - timestamp) / 60_000)
    if (!future && minutes == 0L) return "Just now"
    val suffix = if (future) "ahead" else "ago"
    if (minutes < 60) return "${n(minutes)} min $suffix"
    val hours = if (future) ceil(minutes / 60.0).toLong() else minutes / 60
    if (hours < 24) return "${n(hours)} hr $suffix"
    val days = if (future) ceil(hours / 24.0).toLong() else hours / 24
    return "${n(days)} ${if (days == 1L) "day" else "days"} $suffix"
  }

  fun period(trace: WidgetTrace, stale: Boolean): String {
    if (trace.durationMs == 0L) {
      val count = trace.runs.sumOf { it.size }
      return "$count ${if (count == 1) "reading" else "readings"}"
    }
    val minutes = max(1, (trace.durationMs / 60_000.0).roundToInt())
    val duration = when {
      minutes < 60 -> "${minutes}m"
      minutes % 60 >= 10 -> "${minutes / 60}h ${minutes % 60}m"
      else -> "${minutes / 60}h"
    }
    return "$duration ${if (stale) "to last reading" else "history"}"
  }

  fun draw(context: Context, requestedWidth: Float, requestedHeight: Float,
    snapshot: GlucoseDisplaySnapshot?, now: Long): WidgetCardImage {
    // Keep the host's aspect ratio. Bound bitmap pixels below, not each dimension independently.
    val width = requestedWidth.takeIf { it.isFinite() && it > 0 } ?: 380f
    val height = requestedHeight.takeIf { it.isFinite() && it > 0 } ?: 238f
    // Bound launcher bitmap memory while retaining crisp device-density text.
    val metrics = context.resources.displayMetrics
    val pixelBudget = min(600_000f, metrics.widthPixels.toFloat() * metrics.heightPixels * .35f)
    val pixelScale = min(metrics.density.coerceAtMost(3f), sqrt(pixelBudget / (width * height)))
    val bitmap = Bitmap.createBitmap((width * pixelScale).roundToInt(), (height * pixelScale).roundToInt(), Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap).apply { scale(pixelScale, pixelScale) }
    val spec = asset(context, "current-glucose-card.json")
    fun s(name: String) = spec.getDouble(name).toFloat()
    val prefs = T1ArcGlucoseDisplayState.preferences(context)
    val mode = prefs.getString("widget_theme", "system")
    val dark = if (mode == "system") context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK == Configuration.UI_MODE_NIGHT_YES else mode == "dark"
    val palette = prefs.getString("widget_palette", "editorial") ?: "editorial"
    val colors = asset(context, "app-colors.json").getJSONObject(palette + if (dark) "Dark" else "Light")
    fun color(key: String) = Color.parseColor(colors.getString(key))
    val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    val clip = Path().apply { addRoundRect(RectF(0f,0f,width,height),s("radius"),s("radius"),Path.Direction.CW) }
    canvas.clipPath(clip)
    paint.shader = LinearGradient(width * .02f,0f,width * .9f,height,
      intArrayOf(color("surfaceGradientStart"),color("surfaceGradientMiddle"),color("surfaceGradientEnd")),floatArrayOf(0f,.46f,1f),Shader.TileMode.CLAMP)
    canvas.drawRect(0f,0f,width,height,paint)
    paint.shader = LinearGradient(0f,0f,width * .82f,height * .7f,
      if (dark) intArrayOf(0x11FFFFFF,0x078EA7FF,0x00FFFFFF) else intArrayOf(0xEBFFFFFF.toInt(),0x33FFFFFF,0x00FFFFFF),
      floatArrayOf(0f,.34f,.72f),Shader.TileMode.CLAMP)
    canvas.drawRect(0f,0f,width,height,paint)
    paint.shader = null
    paint.color = color("surfaceBorder"); paint.style = Paint.Style.STROKE; paint.strokeWidth = .5f
    canvas.drawRoundRect(RectF(.25f,.25f,width-.25f,height-.25f),s("radius"),s("radius"),paint)
    paint.style = Paint.Style.FILL
    val onBoard = T1ArcOnBoardEstimateState.presentation(context, snapshot, OnBoardSurface.WIDGET, now)
    if (GlucoseWidgetLayoutPolicy.variant(width, height) == WidgetVariant.COMPACT) {
      return drawCompact(context, canvas, bitmap, width, height, snapshot, now, onBoard, dark) { color(it) }
    }
    // Constrained hosts scale the entire card instead of dropping its graph or labels.
    val actualFreshness = snapshot?.let { DisplayFreshnessPolicy.resolve(it.timestampMs,now,it.sourceHasError) }
    val fontScale = context.resources.configuration.fontScale.coerceIn(1f,1.3f)
    val wrappedDetails = snapshot?.trendOrigin == "calculated" && actualFreshness != DisplayFreshness.STALE && (snapshot.trend != "flat" || fontScale > 1f)
    val neededHeight = s("minHeight") + (fontScale - 1f) * 110f +
      (if (snapshot?.sourceIsLive == true && actualFreshness != DisplayFreshness.CURRENT) 85f else 0f) +
      (if (wrappedDetails) 45f else 0f) +
      (if (onBoard != null) ON_BOARD_ROW_HEIGHT * fontScale else 0f)
    val scale = min(1f, min(width / 340f, height / neededHeight))
    canvas.scale(scale,scale)
    val w = width / scale; val h = height / scale
    val font = context.resources.configuration.fontScale.coerceIn(1f,1.3f)
    val pad = s("padding")
    val tp = TextPaint(Paint.ANTI_ALIAS_FLAG)
    fun setup(size: Float, tint: Int, bold: Boolean = false, spacing: Float = 0f) {
      tp.textSize = size * font; tp.color = tint
      tp.typeface = Typeface.create("sans-serif", if (bold) Typeface.BOLD else Typeface.NORMAL)
      tp.letterSpacing = spacing / (size * font)
    }
    fun text(value: String, x: Float, top: Float, size: Float, lineHeight: Float, tint: Int, bold: Boolean = false, spacing: Float = 0f): Float {
      setup(size,tint,bold,spacing)
      val metrics=tp.fontMetrics
      canvas.drawText(value,x,top + (lineHeight * font - (metrics.descent-metrics.ascent))/2 - metrics.ascent,tp)
      return tp.measureText(value)
    }
    fun paragraph(value: String, top: Float): Float {
      setup(12f,color("textSecondary"))
      val layout=StaticLayout.Builder.obtain(value,0,value.length,tp,(w-pad*2).toInt()).setAlignment(Layout.Alignment.ALIGN_NORMAL).setIncludePad(false).build()
      canvas.save();canvas.translate(pad,top);layout.draw(canvas);canvas.restore()
      return layout.height.toFloat()
    }
    val fresh=snapshot?.let { DisplayFreshnessPolicy.resolve(it.timestampMs,now,it.sourceHasError) } ?: DisplayFreshness.MISSING
    val stale=fresh==DisplayFreshness.STALE
    val appearance=T1ArcGlucoseDisplayState.appearance(context)
    val glucoseColors=asset(context,"glucose-colors.json")
    fun glucoseColor(value: Double, freshness: DisplayFreshness): Int = Color.parseColor(glucoseColors.getJSONObject(appearance.tokenFor(value,freshness)).getString(if(dark) "dark" else "light"))
    val tone=glucoseColor(snapshot?.mmolL ?: 0.0,fresh)
    val trace=snapshot?.let { glucoseWidgetTrace(it.widgetHistory,it.timestampMs) }
    val traceTop=s("traceTop") + (font-1)*20
    if(trace!=null) {
      canvas.save();canvas.translate(s("traceInset"),traceTop)
      GlucoseWidgetChart.draw(canvas,w-2*s("traceInset"),s("traceHeight"),trace,if(stale) color("textTertiary") else color("glucose"),stale) { glucoseColor(it,DisplayFreshness.CURRENT) }
      canvas.restore()
      val period=period(trace,stale)
      setup(s("periodSize"),color("textTertiary"),true)
      text(period,w-s("traceInset")-2-tp.measureText(period),traceTop,s("periodSize"),13f,color("textTertiary"),true)
    }
    text(if(stale) "Last known" else "Now",pad,pad,s("labelSize"),s("labelLineHeight"),color("textSecondary"),true)
    val locale=T1ArcGlucoseDisplayState.displayLocale(context)
    val age=snapshot?.let { age(it.timestampMs,now,locale) } ?: "No data"
    if(snapshot!=null) {
      setup(s("ageSize"),color("textSecondary"))
      text(age,w-pad-tp.measureText(age),pad,s("ageSize"),s("ageLineHeight"),color("textSecondary"))
    }
    if(fresh!=DisplayFreshness.CURRENT) {
      val status=fresh.label
      val statusTone=if(fresh==DisplayFreshness.DELAYED) color("warning") else color("danger")
      setup(12f,statusTone,true);val sw=tp.measureText(status)+33
      val statusTop = if (snapshot == null) pad else pad+23
      val rect=RectF(w-pad-sw,statusTop,w-pad,statusTop+32)
      paint.color=(statusTone and 0x00FFFFFF) or 0x1F000000
      canvas.drawRoundRect(rect,99f,99f,paint)
      paint.color=(statusTone and 0x00FFFFFF) or 0x55000000;paint.style=Paint.Style.STROKE;paint.strokeWidth=.5f
      canvas.drawRoundRect(rect,99f,99f,paint);paint.style=Paint.Style.FILL
      paint.color=statusTone;canvas.drawCircle(rect.left+13.5f,rect.centerY(),3.5f,paint)
      text(status,rect.left+23,statusTop+8,12f,16f,statusTone,true)
    }
    if(snapshot==null) {
      text("No reading",pad,75f,30f,38f,color("text"),true)
      paragraph("Connect a glucose source whenever you are ready.",125f)
      setup(13f,color("onPrimary"),true)
      val buttonWidth=min(w-pad*2,tp.measureText("Choose glucose source  →")+30)
      paint.color=color("primary")
      canvas.drawRoundRect(RectF(pad,h-pad-48,pad+buttonWidth,h-pad),13f,13f,paint)
      text("Choose glucose source  →",pad+15,h-pad-34,13f,20f,color("onPrimary"),true)
      return WidgetCardImage(bitmap,"Current glucose is unavailable. Choose glucose source.",null)
    }
    val trend=asset(context,"glucose-trends.json").optJSONObject(snapshot.trend) ?: asset(context,"glucose-trends.json").getJSONObject("unknown")
    val arrow=trend.getString("arrow")
    val direction=trend.getString("label").replaceFirstChar { it.titlecase(locale) } + if(snapshot.trendOrigin=="calculated") " (calculated)" else ""
    val value=T1ArcGlucoseDisplayState.displayGlucoseValue(context,snapshot.mmolL)
    val valueTop=pad+s("labelLineHeight")*font+s("readingMarginTop") + if(fresh!=DisplayFreshness.CURRENT) 35f else 0f
    val valueWidth=text(value,pad,valueTop,s("valueSize"),s("valueLineHeight"),tone,true,s("valueLetterSpacing"))
    val unitX=pad+valueWidth+s("unitMarginLeft")
    val unitTop=valueTop+(s("valueLineHeight")-s("arrowLineHeight")-s("unitLineHeight"))*font/2+s("unitPaddingTop")/2
    val arrowWidth=text(arrow,unitX,unitTop,s("arrowSize"),s("arrowLineHeight"),tone,true)
    text(T1ArcGlucoseDisplayState.displayGlucoseUnit(context),unitX,unitTop+s("arrowLineHeight")*font+2,s("unitSize"),s("unitLineHeight"),color("textSecondary"),true)
    if(stale) {
      paint.color=tone;paint.strokeWidth=2f
      canvas.drawLine(pad,valueTop+s("valueLineHeight")*font*.55f,pad+valueWidth,valueTop+s("valueLineHeight")*font*.55f,paint)
      canvas.drawLine(unitX,unitTop+s("arrowLineHeight")*font*.55f,unitX+arrowWidth,unitTop+s("arrowLineHeight")*font*.55f,paint)
    }
    val warning = if(fresh==DisplayFreshness.CURRENT || !snapshot.sourceIsLive) null else if(snapshot.sourceHasError)
      "The last source check failed. Open Settings to check the connection and retry." else if(snapshot.sourceCheckedAt > snapshot.timestampMs)
      "Source checked ${age(snapshot.sourceCheckedAt, now, locale)}; the reading is still from ${RegionalTimeFormatter.format(snapshot.timestampMs, locale, T1ArcGlucoseDisplayState.displayTimeZone(context))}. A successful check does not mean a new reading arrived."
      else "Waiting for a newer reading. Open Settings to check the source connection."
    // Reserve bottom lines for the same source warning as Today when delayed/stale.
    val warningHeight=if(warning!=null) { setup(12f,color("textSecondary")); StaticLayout.Builder.obtain(warning,0,warning.length,tp,(w-pad*2).toInt()).setIncludePad(false).build().height+12f } else 0f
    // Insulin and carbs on board sit in their own row between the trace and the footer.
    val onBoardRow=if(onBoard!=null) ON_BOARD_ROW_HEIGHT*font else 0f
    val footerTop=max(traceTop+s("traceHeight")+12+onBoardRow,h-pad-s("rangeHeight")*font-warningHeight-(if(wrappedDetails) 45f else 0f))
    if(onBoard!=null) {
      setup(12f,color("textSecondary"))
      val onBoardSize=min(12f,12f*(w-pad*2)/max(1f,tp.measureText(onBoard.compact)))
      text(onBoard.compact,pad,footerTop-onBoardRow,onBoardSize,17f,if(onBoard.stale) color("warning") else color("textSecondary"))
    }
    val footerText=if(stale) "Stale · last known reading" else direction
    val symbol=if(stale) "⊙" else if(snapshot.trend=="flat") "−" else if(snapshot.trend=="unknown") "?" else if(snapshot.trend.contains("Down") || snapshot.trend=="down") "↘" else "↗"
    text(symbol,pad,footerTop+5,18f,20f,tone)
    val detailWidth=text(footerText,pad+25,footerTop+5,s("detailSize"),s("detailLineHeight"),color("text"),true)
    var nextX=pad+25+detailWidth+s("footerGap")
    var rowTop=footerTop
    var details: RectF?=null
    if(!stale) {
      val range=when(appearance.categoryFor(snapshot.mmolL)) { "veryLow"->"Very low";"low"->"Low";"target"->"In range";"high"->"High";else->"Very high" }
      setup(s("rangeTextSize"),tone,true)
      val pillWidth=tp.measureText(range)+33
      if(nextX+pillWidth>w-pad) { nextX=pad;rowTop+=35*font }
      val rect=RectF(nextX,rowTop,nextX+pillWidth,rowTop+s("rangeHeight")*font)
      paint.color=(tone and 0x00FFFFFF) or 0x18000000;canvas.drawRoundRect(rect,99f,99f,paint)
      paint.color=(tone and 0x00FFFFFF) or 0x66000000;paint.style=Paint.Style.STROKE;paint.strokeWidth=.5f;canvas.drawRoundRect(rect,99f,99f,paint);paint.style=Paint.Style.FILL
      paint.color=tone;canvas.drawCircle(nextX+13.5f,rect.centerY(),3.5f,paint)
      text(range,nextX+23,rowTop+7,s("rangeTextSize"),16f,tone,true)
      nextX+=pillWidth+10
      if(snapshot.trendOrigin=="calculated") {
        if(nextX+44>w-pad) { nextX=pad;rowTop+=44 }
        val button=RectF(nextX,rowTop-7,nextX+44,rowTop+37)
        val accent=color("accent")
        paint.color=(accent and 0x00FFFFFF) or 0x12000000
        canvas.drawRoundRect(button,99f,99f,paint)
        paint.color=(accent and 0x00FFFFFF) or 0x44000000;paint.strokeWidth=.5f;paint.style=Paint.Style.STROKE
        canvas.drawRoundRect(button,99f,99f,paint)
        paint.color=accent;paint.strokeWidth=1.4f
        canvas.drawRoundRect(RectF(nextX+13,rowTop+5,nextX+31,rowTop+23),3f,3f,paint)
        val icon=Path().apply {moveTo(nextX+16,rowTop+18);lineTo(nextX+20,rowTop+13);lineTo(nextX+24,rowTop+17);lineTo(nextX+28,rowTop+10)}
        canvas.drawPath(icon,paint);paint.style=Paint.Style.FILL
        details=RectF(button.left*scale,button.top*scale,button.right*scale,button.bottom*scale)
      }
    }
    if(warning!=null) paragraph(warning,rowTop+s("rangeHeight")*font+12)
    val description=(if(stale) "Last known glucose $value ${T1ArcGlucoseDisplayState.displayGlucoseSpokenUnit(context)}, shown struck through because it is stale. Updated $age." else "Current glucose $value ${T1ArcGlucoseDisplayState.displayGlucoseSpokenUnit(context)}, $direction. ${fresh.label}, updated $age.") +
      (onBoard?.let { " ${it.spoken}" } ?: "")
    return WidgetCardImage(bitmap,description,details)
  }

  /**
   * Small resized widgets: value, arrow and age, with insulin and carbs on
   * board when they fit. Stale values stay struck through, as on Today.
   */
  private fun drawCompact(context: Context, canvas: Canvas, bitmap: Bitmap, width: Float, height: Float,
    snapshot: GlucoseDisplaySnapshot?, now: Long, onBoard: OnBoardText?, dark: Boolean,
    color: (String) -> Int): WidgetCardImage {
    val font = context.resources.configuration.fontScale.coerceIn(1f, 1.3f)
    val locale = T1ArcGlucoseDisplayState.displayLocale(context)
    val tp = TextPaint(Paint.ANTI_ALIAS_FLAG)
    fun setup(size: Float, tint: Int, bold: Boolean) {
      tp.textSize = size; tp.color = tint; tp.letterSpacing = 0f
      tp.typeface = Typeface.create("sans-serif", if (bold) Typeface.BOLD else Typeface.NORMAL)
    }
    fun measure(value: String, size: Float, bold: Boolean): Float { setup(size, 0, bold); return tp.measureText(value) }
    fun lineHeight(size: Float): Float { setup(size, 0, false); return tp.fontMetrics.let { it.descent - it.ascent } }
    /** The largest size up to [max] at which [value] fits [available], or null below [min]. */
    fun fit(value: String, max: Float, min: Float, available: Float, bold: Boolean): Float? {
      val natural = measure(value, max, bold)
      val size = if (natural <= available) max else max * available / natural
      return size.takeIf { it >= min }
    }
    fun draw(value: String, x: Float, top: Float, size: Float, tint: Int, bold: Boolean): Float {
      setup(size, tint, bold)
      canvas.drawText(value, x, top - tp.fontMetrics.ascent, tp)
      return tp.measureText(value)
    }
    val pad = (min(width, height) * 0.12f).coerceIn(6f, 14f)
    val innerW = width - pad * 2
    val innerH = height - pad * 2
    if (snapshot == null) {
      val message = "No reading"
      val size = fit(message, min(22f * font, innerH * 0.6f), 6f, innerW, true) ?: 6f
      val messageWidth = measure(message, size, true)
      draw(message, (width - messageWidth) / 2, (height - lineHeight(size)) / 2, size, color("text"), true)
      return WidgetCardImage(bitmap, "Current glucose is unavailable. Choose glucose source.", null)
    }
    val fresh = DisplayFreshnessPolicy.resolve(snapshot.timestampMs, now, snapshot.sourceHasError)
    val stale = fresh == DisplayFreshness.STALE
    val appearance = T1ArcGlucoseDisplayState.appearance(context)
    val tone = Color.parseColor(asset(context, "glucose-colors.json")
      .getJSONObject(appearance.tokenFor(snapshot.mmolL, fresh)).getString(if (dark) "dark" else "light"))
    val trends = asset(context, "glucose-trends.json")
    val trend = trends.optJSONObject(snapshot.trend) ?: trends.getJSONObject("unknown")
    val arrow = trend.getString("arrow")
    val direction = trend.getString("label").replaceFirstChar { it.titlecase(locale) } +
      if (snapshot.trendOrigin == "calculated") " (calculated)" else ""
    val value = T1ArcGlucoseDisplayState.displayGlucoseValue(context, snapshot.mmolL)
    val age = age(snapshot.timestampMs, now, locale)
    val status = when (fresh) {
      DisplayFreshness.STALE -> "Last known · $age"
      DisplayFreshness.DELAYED -> "Delayed · $age"
      else -> age
    }
    val statusTint = when (fresh) {
      DisplayFreshness.STALE -> color("danger")
      DisplayFreshness.DELAYED -> color("warning")
      else -> color("textSecondary")
    }
    val boardTint = if (onBoard?.stale == true) color("warning") else color("textSecondary")
    val arrowRatio = 0.6f
    fun valueWidth(size: Float) = measure(value, size, true) + size * 0.12f + measure(arrow, size * arrowRatio, true)
    fun drawValue(x: Float, top: Float, size: Float) {
      val valueW = draw(value, x, top, size, tone, true)
      val arrowSize = size * arrowRatio
      val arrowX = x + valueW + size * 0.12f
      val arrowTop = top + (lineHeight(size) - lineHeight(arrowSize)) / 2
      val arrowW = draw(arrow, arrowX, arrowTop, arrowSize, tone, true)
      if (stale) {
        val line = Paint(Paint.ANTI_ALIAS_FLAG).apply { this.color = tone; strokeWidth = max(1.5f, size / 22f) }
        val middle = top + lineHeight(size) * 0.55f
        canvas.drawLine(x, middle, x + valueW, middle, line)
        val arrowMiddle = arrowTop + lineHeight(arrowSize) * 0.55f
        canvas.drawLine(arrowX, arrowMiddle, arrowX + arrowW, arrowMiddle, line)
      }
    }
    val plan = GlucoseWidgetLayoutPolicy.compactPlan(width, height, onBoard != null)
    var shownBoard: String? = if (plan.showOnBoard) onBoard?.compact else null
    if (plan.row) {
      val statusSize = min(13f * font, innerH * 0.34f)
      val boardSize = min(12f * font, innerH * 0.3f)
      val gap = 10f
      val maxValue = min(innerH * 0.8f, 46f)
      fun valueSizeFor(rightWidth: Float): Float {
        val available = innerW - gap - rightWidth
        return min(maxValue, maxValue * available / max(1f, valueWidth(maxValue)))
      }
      val boardWidth = shownBoard?.let { measure(it, boardSize, false) } ?: 0f
      var rightWidth = max(measure(status, statusSize, false), boardWidth)
      var valueSize = valueSizeFor(rightWidth)
      if (shownBoard != null && valueSize < 18f) {
        shownBoard = null
        rightWidth = measure(status, statusSize, false)
        valueSize = valueSizeFor(rightWidth)
      }
      if (valueSize >= 14f) {
        drawValue(pad, (height - lineHeight(valueSize)) / 2, valueSize)
        val rowBoard = shownBoard
        val blockHeight = lineHeight(statusSize) + (if (rowBoard != null) 2f + lineHeight(boardSize) else 0f)
        var top = (height - blockHeight) / 2
        draw(status, width - pad - measure(status, statusSize, false), top, statusSize, statusTint, false)
        if (rowBoard != null) {
          top += lineHeight(statusSize) + 2f
          draw(rowBoard, width - pad - measure(rowBoard, boardSize, false), top, boardSize, boardTint, false)
        }
        return WidgetCardImage(bitmap, compactDescription(context, value, direction, fresh, age, stale,
          if (rowBoard != null) onBoard?.spoken else null), null)
      }
      shownBoard = if (plan.showOnBoard) onBoard?.compact else null
    }
    // Stacked: value and arrow, then age, then insulin and carbs on board.
    val preferredStatus = min(12f * font, innerH * 0.18f).coerceAtLeast(7f)
    val statusText = if (fit(status, preferredStatus, 6f, innerW, false) != null) status else age
    val statusSize = fit(statusText, preferredStatus, 6f, innerW, false) ?: 6f
    val stackBoard = shownBoard
    val boardSize = if (stackBoard == null) null
      else fit(stackBoard, min(11f * font, innerH * 0.15f).coerceAtLeast(7f), 7f, innerW, false)
    val board = if (boardSize != null) stackBoard else null
    val linesHeight = lineHeight(statusSize) + 2f +
      (if (board != null && boardSize != null) lineHeight(boardSize) + 2f else 0f)
    val heightForValue = (innerH - linesHeight).coerceAtLeast(10f)
    val maxValue = min(heightForValue / 1.17f, 60f)
    val valueSize = min(maxValue, maxValue * innerW / max(1f, valueWidth(maxValue))).coerceAtLeast(8f)
    var top = (height - (lineHeight(valueSize) + linesHeight)) / 2
    drawValue((width - valueWidth(valueSize)) / 2, top, valueSize)
    top += lineHeight(valueSize) + 2f
    draw(statusText, (width - measure(statusText, statusSize, false)) / 2, top, statusSize, statusTint, false)
    if (board != null && boardSize != null) {
      top += lineHeight(statusSize) + 2f
      draw(board, (width - measure(board, boardSize, false)) / 2, top, boardSize, boardTint, false)
    }
    return WidgetCardImage(bitmap, compactDescription(context, value, direction, fresh, age, stale,
      if (board != null) onBoard?.spoken else null), null)
  }

  private fun compactDescription(context: Context, value: String, direction: String, fresh: DisplayFreshness,
    age: String, stale: Boolean, onBoardSpoken: String?): String {
    val unit = T1ArcGlucoseDisplayState.displayGlucoseSpokenUnit(context)
    val glucose = if (stale) "Last known glucose $value $unit, shown struck through because it is stale. Updated $age."
      else "Current glucose $value $unit, $direction. ${fresh.label}, updated $age."
    return glucose + (onBoardSpoken?.let { " $it" } ?: "")
  }
}
