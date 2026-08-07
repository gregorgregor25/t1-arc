package app.daymark.wear

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import android.view.View
import app.daymark.wear.data.GlucoseFreshness
import app.daymark.wear.data.GlucoseSemantics
import app.daymark.wear.data.GlucoseSnapshot
import java.util.Locale
import kotlin.math.min

class DaymarkWatchView(context: Context) : View(context) {
    var snapshot: GlucoseSnapshot? = null
        set(value) {
            field = value
            contentDescription = accessibilityDescription(value)
            invalidate()
        }

    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        canvas.drawColor(Color.BLACK)
        val scale = min(width, height) / 450f
        canvas.save()
        canvas.translate((width - 450f * scale) / 2f, (height - 450f * scale) / 2f)
        canvas.scale(scale, scale)

        val freshness = GlucoseSemantics.freshness(snapshot)
        val tone = tone(snapshot, freshness)
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = 2f
        paint.color = Color.rgb(24, 53, 60)
        canvas.drawArc(RectF(28f, 28f, 422f, 422f), 208f, 124f, false, paint)
        paint.color = tone
        paint.strokeCap = Paint.Cap.ROUND
        paint.strokeWidth = 5f
        canvas.drawArc(RectF(28f, 28f, 422f, 422f), 208f, 42f, false, paint)

        drawText(canvas, "T1 ARC", 225f, 72f, 17f, Color.rgb(101, 210, 231), Paint.Align.CENTER, true)

        if (snapshot == null) {
            drawText(canvas, "--", 225f, 220f, 92f, Color.rgb(169, 189, 194), Paint.Align.CENTER, true)
            drawText(canvas, "NO GLUCOSE YET", 225f, 270f, 17f, Color.WHITE, Paint.Align.CENTER, true)
            drawText(canvas, "Open T1 Arc on your phone", 225f, 310f, 15f, Color.rgb(169, 189, 194), Paint.Align.CENTER)
        } else {
            val value = String.format(Locale.UK, "%.1f", snapshot!!.mmolL)
            val arrow = GlucoseSemantics.arrow(snapshot!!.trend)
            drawGlucoseValue(
                canvas,
                "$value  $arrow",
                225f,
                225f,
                86f,
                tone,
                freshness == GlucoseFreshness.STALE,
            )
            drawText(canvas, "mmol/L", 225f, 258f, 16f, Color.rgb(169, 189, 194), Paint.Align.CENTER, true)

            paint.style = Paint.Style.FILL
            paint.color = Color.rgb(15, 35, 40)
            canvas.drawRoundRect(RectF(128f, 285f, 322f, 331f), 23f, 23f, paint)
            drawText(
                canvas,
                "${GlucoseSemantics.statusTitle(snapshot, freshness)}  ·  ${GlucoseSemantics.ageLabel(snapshot)}",
                225f,
                314f,
                15f,
                if (freshness == GlucoseFreshness.CURRENT) Color.WHITE else tone,
                Paint.Align.CENTER,
                true,
            )
            drawText(
                canvas,
                if (GlucoseSemantics.trendIsCalculated(snapshot)) {
                    "CALCULATED TREND  ·  FROM PHONE"
                } else {
                    "FROM YOUR PHONE"
                },
                225f,
                367f,
                13f,
                Color.rgb(120, 148, 154),
                Paint.Align.CENTER,
                true,
            )
        }
        canvas.restore()
    }

    private fun drawText(
        canvas: Canvas,
        text: String,
        x: Float,
        baseline: Float,
        size: Float,
        color: Int,
        alignment: Paint.Align,
        bold: Boolean = false,
    ) {
        paint.style = Paint.Style.FILL
        paint.textAlign = alignment
        paint.textSize = size
        paint.color = color
        paint.letterSpacing = if (size <= 18f) 0.08f else 0f
        paint.typeface =
            Typeface.create(
                Typeface.DEFAULT,
                if (bold) Typeface.BOLD else Typeface.NORMAL,
            )
        canvas.drawText(text, x, baseline, paint)
    }

    private fun drawGlucoseValue(
        canvas: Canvas,
        text: String,
        x: Float,
        baseline: Float,
        size: Float,
        color: Int,
        stale: Boolean,
    ) {
        drawText(canvas, text, x, baseline, size, color, Paint.Align.CENTER, true)
        if (!stale) return
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = 5f
        paint.strokeCap = Paint.Cap.ROUND
        paint.color = color
        val halfWidth = paint.measureText(text) / 2f
        canvas.drawLine(
            x - halfWidth,
            baseline - size * 0.31f,
            x + halfWidth,
            baseline - size * 0.31f,
            paint,
        )
    }

    private fun tone(
        snapshot: GlucoseSnapshot?,
        freshness: GlucoseFreshness,
    ): Int = GlucoseSemantics.colorArgb(snapshot, freshness)

    private fun accessibilityDescription(snapshot: GlucoseSnapshot?): String {
        snapshot ?: return "T1 Arc. No glucose reading is available."
        val freshness = GlucoseSemantics.freshness(snapshot)
        return "T1 Arc. " +
            (if (freshness == GlucoseFreshness.STALE) "Last known stale glucose, " else "Current glucose, ") +
            "${String.format(Locale.UK, "%.1f", snapshot.mmolL)} millimoles per litre, " +
            "${GlucoseSemantics.arrow(snapshot.trend)}, " +
            (if (GlucoseSemantics.trendIsCalculated(snapshot)) {
                "calculated trend, "
            } else {
                ""
            }) +
            "${freshness.label}, ${GlucoseSemantics.ageLabel(snapshot)}."
    }
}
