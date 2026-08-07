package app.daymark.wear

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Typeface
import android.view.MotionEvent
import android.view.View
import app.daymark.wear.data.GlucoseFreshness
import app.daymark.wear.data.GlucoseHistoryPoint
import app.daymark.wear.data.GlucoseSemantics
import app.daymark.wear.data.GlucoseSnapshot
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import kotlin.math.max
import kotlin.math.min

class DaymarkGraphView(context: Context) : View(context) {
    var snapshot: GlucoseSnapshot? = null
        set(value) {
            field = value
            updateDescription()
            invalidate()
        }
    var history: List<GlucoseHistoryPoint> = emptyList()
        set(value) {
            field = value.sortedBy(GlucoseHistoryPoint::timestampMs)
            updateDescription()
            invalidate()
        }

    private var windowHours = 3
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val chart = RectF(48f, 190f, 402f, 334f)
    private val londonTime =
        SimpleDateFormat("HH:mm", Locale.UK).apply {
            timeZone = TimeZone.getTimeZone("Europe/London")
        }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        canvas.drawColor(Color.BLACK)
        val scale = min(width, height) / 450f
        canvas.save()
        canvas.translate((width - 450f * scale) / 2f, (height - 450f * scale) / 2f)
        canvas.scale(scale, scale)

        val freshness = GlucoseSemantics.freshness(snapshot)
        val tone = valueColor(snapshot, freshness)
        drawText(canvas, "T1 ARC  ·  $windowHours HOURS", 225f, 54f, 15f, 0xFF78949A.toInt())

        if (snapshot == null) {
            drawText(canvas, "--", 225f, 130f, 70f, 0xFFA9BDC2.toInt(), true)
            drawText(canvas, "WAITING FOR GLUCOSE", 225f, 164f, 15f, Color.WHITE, true)
        } else {
            val value = String.format(Locale.UK, "%.1f", snapshot!!.mmolL)
            drawText(
                canvas,
                "$value ${GlucoseSemantics.arrow(snapshot!!.trend)}",
                225f,
                130f,
                72f,
                tone,
                true,
                strikethrough = freshness == GlucoseFreshness.STALE,
            )
            drawText(
                canvas,
                "mmol/L  ·  ${GlucoseSemantics.statusTitle(snapshot, freshness)}  ·  ${GlucoseSemantics.ageLabel(snapshot)}",
                225f,
                165f,
                15f,
                if (freshness == GlucoseFreshness.CURRENT) Color.WHITE else tone,
                true,
            )
        }

        drawChart(canvas, tone)
        drawText(
            canvas,
            if (windowHours == 3) "TAP FOR 6 HOURS" else "TAP FOR 3 HOURS",
            225f,
            388f,
            14f,
            0xFF65D2E7.toInt(),
            true,
        )
        drawText(canvas, "Swipe right to close", 225f, 419f, 13f, 0xFF78949A.toInt())
        canvas.restore()
    }

    private fun drawChart(canvas: Canvas, tone: Int) {
        val end = history.lastOrNull()?.timestampMs ?: System.currentTimeMillis()
        val start = end - windowHours * 60 * 60_000L
        val points = history.filter { it.timestampMs in start..end }

        paint.style = Paint.Style.FILL
        paint.color = 0xFF08161A.toInt()
        canvas.drawRoundRect(chart, 24f, 24f, paint)
        val measuredMinimum = points.minOfOrNull(GlucoseHistoryPoint::mmolL) ?: 3.9
        val measuredMaximum = points.maxOfOrNull(GlucoseHistoryPoint::mmolL) ?: 10.0
        val rawMinimum = min(3.9, measuredMinimum)
        val rawMaximum = max(10.0, measuredMaximum)
        val padding = max(0.6, (rawMaximum - rawMinimum) * 0.08)
        val minValue =
            max(0.0, kotlin.math.floor((rawMinimum - padding) * 2.0) / 2.0)
        val maxValue =
            max(
                minValue + 1.0,
                kotlin.math.ceil((rawMaximum + padding) * 2.0) / 2.0,
            )
        fun x(timestamp: Long) =
            chart.left + (timestamp - start).toFloat() /
                max(1L, end - start) * chart.width()
        fun y(value: Double) =
            chart.bottom - ((value - minValue) / (maxValue - minValue)).toFloat() * chart.height()

        val targetTop = y(10.0).coerceIn(chart.top, chart.bottom)
        val targetBottom = y(3.9).coerceIn(chart.top, chart.bottom)
        paint.color = 0x2A65D2E7
        canvas.drawRect(chart.left, targetTop, chart.right, targetBottom, paint)
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = 1.5f
        paint.color = 0xFF27454B.toInt()
        canvas.drawLine(chart.left, targetTop, chart.right, targetTop, paint)
        canvas.drawLine(chart.left, targetBottom, chart.right, targetBottom, paint)

        if (points.size > 1) {
            paint.strokeWidth = 5f
            paint.strokeCap = Paint.Cap.ROUND
            paint.strokeJoin = Paint.Join.ROUND
            points.zipWithNext().forEach { (previous, point) ->
                if (point.timestampMs - previous.timestampMs <= 12 * 60_000L) {
                    val startX = x(previous.timestampMs)
                    val startY = y(previous.mmolL)
                    val endX = x(point.timestampMs)
                    val endY = y(point.mmolL)
                    val middleX = (startX + endX) / 2f
                    val middleY = (startY + endY) / 2f
                    paint.color = GlucoseSemantics.colorArgb(previous.colorToken)
                    canvas.drawLine(startX, startY, middleX, middleY, paint)
                    paint.color = GlucoseSemantics.colorArgb(point.colorToken)
                    canvas.drawLine(middleX, middleY, endX, endY, paint)
                }
            }
            val last = points.last()
            paint.color = GlucoseSemantics.colorArgb(last.colorToken)
            paint.style = Paint.Style.FILL
            canvas.drawCircle(x(last.timestampMs), y(last.mmolL), 8f, paint)
            paint.style = Paint.Style.STROKE
            paint.strokeWidth = 3f
            paint.color = Color.WHITE
            canvas.drawCircle(x(last.timestampMs), y(last.mmolL), 8f, paint)
        } else {
            drawText(canvas, "History is syncing from your phone", 225f, 270f, 14f, 0xFFA9BDC2.toInt())
        }

        drawText(canvas, formatScale(maxValue), 42f, chart.top + 5f, 12f, 0xFF78949A.toInt(), align = Paint.Align.RIGHT)
        drawText(canvas, formatScale(minValue), 42f, chart.bottom, 12f, 0xFF78949A.toInt(), align = Paint.Align.RIGHT)
        drawText(canvas, londonTime.format(Date(start)), chart.left, 360f, 12f, 0xFF78949A.toInt(), align = Paint.Align.LEFT)
        drawText(canvas, "NOW", chart.right, 360f, 12f, 0xFF78949A.toInt(), align = Paint.Align.RIGHT)
    }

    private fun formatScale(value: Double): String =
        if (kotlin.math.abs(value - kotlin.math.round(value)) < 0.05) {
            kotlin.math.round(value).toInt().toString()
        } else {
            String.format(Locale.UK, "%.1f", value)
        }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        if (event.action == MotionEvent.ACTION_UP) {
            windowHours = if (windowHours == 3) 6 else 3
            updateDescription()
            invalidate()
            performClick()
        }
        return true
    }

    override fun performClick(): Boolean {
        super.performClick()
        return true
    }

    private fun drawText(
        canvas: Canvas,
        text: String,
        x: Float,
        baseline: Float,
        size: Float,
        color: Int,
        bold: Boolean = false,
        align: Paint.Align = Paint.Align.CENTER,
        strikethrough: Boolean = false,
    ) {
        paint.style = Paint.Style.FILL
        paint.textAlign = align
        paint.textSize = size
        paint.color = color
        paint.typeface =
            Typeface.create(Typeface.DEFAULT, if (bold) Typeface.BOLD else Typeface.NORMAL)
        canvas.drawText(text, x, baseline, paint)
        if (strikethrough) {
            paint.style = Paint.Style.STROKE
            paint.strokeWidth = max(3f, size * 0.06f)
            paint.strokeCap = Paint.Cap.ROUND
            val halfWidth = paint.measureText(text) / 2f
            canvas.drawLine(
                x - halfWidth,
                baseline - size * 0.31f,
                x + halfWidth,
                baseline - size * 0.31f,
                paint,
            )
        }
    }

    private fun valueColor(
        snapshot: GlucoseSnapshot?,
        freshness: GlucoseFreshness,
    ): Int = GlucoseSemantics.colorArgb(snapshot, freshness)

    private fun updateDescription() {
        contentDescription =
            if (snapshot == null) {
                "T1 Arc glucose graph. No current reading."
            } else {
                val freshness = GlucoseSemantics.freshness(snapshot)
                (if (freshness == GlucoseFreshness.STALE) {
                    "Last known stale glucose, "
                } else {
                    "Current glucose, "
                }) +
                    "${String.format(Locale.UK, "%.1f", snapshot!!.mmolL)} millimoles per litre. " +
                    "$windowHours hour glucose graph with " +
                    "${history.size} readings. Tap to change time range."
            }
    }
}
