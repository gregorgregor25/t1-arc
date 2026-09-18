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
    val width = requestedWidth.coerceIn(150f, 1000f)
    val height = requestedHeight.coerceIn(80f, 1000f)
    // Share the launcher bitmap budget across at most four layouts, retaining crisp device-density text.
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
    // Constrained hosts scale the entire card instead of dropping its graph or labels.
    val actualFreshness = snapshot?.let { DisplayFreshnessPolicy.resolve(it.timestampMs,now,it.sourceHasError) }
    val fontScale = context.resources.configuration.fontScale.coerceIn(1f,1.3f)
    val wrappedDetails = snapshot?.trendOrigin == "calculated" && actualFreshness != DisplayFreshness.STALE && (snapshot.trend != "flat" || fontScale > 1f)
    val neededHeight = s("minHeight") + (fontScale - 1f) * 110f +
      (if (snapshot?.sourceIsLive == true && actualFreshness != DisplayFreshness.CURRENT) 85f else 0f) +
      (if (wrappedDetails) 45f else 0f)
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
    val footerTop=max(traceTop+s("traceHeight")+12,h-pad-s("rangeHeight")*font-warningHeight-(if(wrappedDetails) 45f else 0f))
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
    val description=if(stale) "Last known glucose $value ${T1ArcGlucoseDisplayState.displayGlucoseSpokenUnit(context)}, shown struck through because it is stale. Updated $age." else "Current glucose $value ${T1ArcGlucoseDisplayState.displayGlucoseSpokenUnit(context)}, $direction. ${fresh.label}, updated $age."
    return WidgetCardImage(bitmap,description,details)
  }
}
