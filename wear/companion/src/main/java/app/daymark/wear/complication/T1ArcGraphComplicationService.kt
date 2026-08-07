package app.daymark.wear.complication

import android.app.PendingIntent
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.DashPathEffect
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Typeface
import android.graphics.drawable.Icon
import androidx.wear.watchface.complications.data.ComplicationData
import androidx.wear.watchface.complications.data.ComplicationType
import androidx.wear.watchface.complications.data.NoDataComplicationData
import androidx.wear.watchface.complications.data.PhotoImageComplicationData
import androidx.wear.watchface.complications.data.PlainComplicationText
import androidx.wear.watchface.complications.datasource.ComplicationRequest
import androidx.wear.watchface.complications.datasource.SuspendingComplicationDataSourceService
import app.daymark.wear.GraphActivity
import app.daymark.wear.data.DaymarkWearRepository
import app.daymark.wear.data.GlucoseFreshness
import app.daymark.wear.data.GlucoseHistoryPoint
import app.daymark.wear.data.GlucoseSemantics
import app.daymark.wear.data.GlucoseSnapshot
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.sin

/**
 * Supplies transparent, live glucose traces to all T1 Arc faces.
 *
 * Watch Face Format cannot evaluate an arbitrary list of historic readings,
 * so the companion renders only the data line and chart furniture into a
 * PHOTO_IMAGE complication. Time, hands, text and all other dial elements
 * remain native watch-face elements.
 */
open class T1ArcGraphComplicationService : SuspendingComplicationDataSourceService() {
    protected open val graphStyle = GraphStyle.MERIDIAN

    override suspend fun onComplicationRequest(request: ComplicationRequest): ComplicationData {
        if (request.complicationType != ComplicationType.PHOTO_IMAGE) {
            return NoDataComplicationData()
        }
        val repository = DaymarkWearRepository.get(this)
        return graphData(
            style = graphStyle,
            snapshot = repository.snapshot(),
            history = repository.history(),
        )
    }

    override fun getPreviewData(type: ComplicationType): ComplicationData? {
        if (type != ComplicationType.PHOTO_IMAGE) return null
        val now = System.currentTimeMillis()
        val history =
            (0..36).map { index ->
                val progress = index / 36.0
                GlucoseHistoryPoint(
                    mmolL =
                        when {
                            progress < 0.25 -> 6.1 + progress * 5.2
                            progress < 0.55 -> 7.4 - (progress - 0.25) * 7.0
                            progress < 0.8 -> 5.3 + (progress - 0.55) * 5.6
                            else -> 6.7 - (progress - 0.8) * 1.5
                        },
                    timestampMs = now - (36 - index) * 5 * 60_000L,
                )
            }
        return graphData(
            graphStyle,
            GlucoseSnapshot(
                mmolL = 6.4,
                trend = "flat",
                timestampMs = now,
                sourceLabel = "T1 Arc preview",
                sourceHasError = false,
                category = "target",
                colorToken = "cyan",
            ),
            history,
        )
    }

    private fun graphData(
        style: GraphStyle,
        snapshot: GlucoseSnapshot?,
        history: List<GlucoseHistoryPoint>,
    ): ComplicationData {
        val bitmap =
            when (style) {
                GraphStyle.MERIDIAN -> renderMeridian(snapshot, history)
                GraphStyle.CHRONOGRAPH -> renderChronograph(snapshot, history)
                GraphStyle.ORBIT -> renderOrbit(snapshot, history)
            }
        val description =
            PlainComplicationText
                .Builder(
                    if (history.isEmpty()) {
                        "No glucose history available"
                    } else {
                        "Three hour glucose history with ${history.size} readings"
                    },
                )
                .build()
        return PhotoImageComplicationData
            .Builder(Icon.createWithBitmap(bitmap), description)
            .setTapAction(
                PendingIntent.getActivity(
                    this,
                    style.ordinal + 20,
                    Intent(this, GraphActivity::class.java),
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                ),
            )
            .build()
    }

    private fun renderMeridian(
        snapshot: GlucoseSnapshot?,
        history: List<GlucoseHistoryPoint>,
    ): Bitmap {
        val bitmap = Bitmap.createBitmap(396, 104, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        val chart = RectF(28f, 7f, 394f, 72f)
        val points = pointsForWindow(history, 3)
        val bounds = chartBounds(points)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        val grid = 0xFF52636A.toInt()

        paint.style = Paint.Style.STROKE
        paint.strokeWidth = 1f
        paint.pathEffect = DashPathEffect(floatArrayOf(2f, 4f), 0f)
        paint.color = grid
        chartTicks(bounds, 4).forEach { value ->
            val y = chartY(value, chart, bounds.first, bounds.second)
            canvas.drawLine(chart.left, y, chart.right, y, paint)
            drawText(canvas, formatScale(value), 22f, y + 4f, 12f, 0xFF9DB6BC.toInt(), Paint.Align.RIGHT)
        }
        paint.pathEffect = null

        val path = historyPath(points, chart, bounds.first, bounds.second)
        if (path != null) {
            val fill = Path(path)
            val last = points.last()
            val first = points.first()
            fill.lineTo(chartX(last.timestampMs, points), chart.bottom)
            fill.lineTo(chartX(first.timestampMs, points), chart.bottom)
            fill.close()
            paint.style = Paint.Style.FILL
            paint.color = 0x392A8B98
            canvas.drawPath(fill, paint)
            paint.style = Paint.Style.STROKE
            paint.strokeWidth = 3f
            paint.strokeCap = Paint.Cap.ROUND
            paint.strokeJoin = Paint.Join.ROUND
            drawColouredLinearTrace(canvas, points, chart, bounds, paint)
            drawEndpoint(
                canvas,
                chartX(last.timestampMs, points, chart),
                chartY(last.mmolL, chart, bounds.first, bounds.second),
                GlucoseSemantics.colorArgb(snapshot, GlucoseSemantics.freshness(snapshot)),
                6f,
            )
        }

        val now = points.lastOrNull()?.timestampMs ?: System.currentTimeMillis()
        val london =
            SimpleDateFormat("H:mm", Locale.UK).apply {
                timeZone = TimeZone.getTimeZone("Europe/London")
            }
        drawText(canvas, london.format(Date(now - 3 * 60 * 60_000L)), chart.left, 98f, 12f, 0xFF9DB6BC.toInt(), Paint.Align.LEFT)
        drawText(canvas, london.format(Date(now - 2 * 60 * 60_000L)), chart.left + chart.width() / 3f, 98f, 12f, 0xFF9DB6BC.toInt())
        drawText(canvas, london.format(Date(now - 60 * 60_000L)), chart.left + chart.width() * 2f / 3f, 98f, 12f, 0xFF9DB6BC.toInt())
        drawText(canvas, london.format(Date(now)), chart.right, 98f, 12f, 0xFF9DB6BC.toInt(), Paint.Align.RIGHT)
        return bitmap
    }

    private fun renderChronograph(
        snapshot: GlucoseSnapshot?,
        history: List<GlucoseHistoryPoint>,
    ): Bitmap {
        val bitmap = Bitmap.createBitmap(188, 154, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        val gold = 0xFFF2D49B.toInt()
        val cyan = 0xFF65D2E7.toInt()
        val chart = RectF(18f, 38f, 170f, 115f)
        val points = pointsForWindow(history, 3)
        val bounds = chartBounds(points)

        paint.style = Paint.Style.STROKE
        paint.strokeWidth = 1.5f
        paint.color = gold
        canvas.drawOval(RectF(1f, 1f, 187f, 153f), paint)
        drawText(canvas, "3 HOURS", 94f, 29f, 12f, cyan, bold = true)

        paint.strokeWidth = 1f
        paint.pathEffect = DashPathEffect(floatArrayOf(3f, 4f), 0f)
        chartTicks(bounds, 3).forEach { value ->
            val y = chartY(value, chart, bounds.first, bounds.second)
            canvas.drawLine(chart.left, y, chart.right, y, paint)
            drawText(canvas, formatScale(value), chart.right - 3f, y - 3f, 10f, 0xFFCFD2D2.toInt(), Paint.Align.RIGHT)
        }
        paint.pathEffect = null

        val path = historyPath(points, chart, bounds.first, bounds.second)
        if (path != null) {
            val fill = Path(path)
            fill.lineTo(chart.right, chart.bottom)
            fill.lineTo(chart.left, chart.bottom)
            fill.close()
            paint.style = Paint.Style.FILL
            paint.color = 0x402A8B98
            canvas.drawPath(fill, paint)
            paint.style = Paint.Style.STROKE
            paint.strokeWidth = 3f
            paint.strokeCap = Paint.Cap.ROUND
            paint.strokeJoin = Paint.Join.ROUND
            drawColouredLinearTrace(canvas, points, chart, bounds, paint)
            val last = points.last()
            drawEndpoint(
                canvas,
                chartX(last.timestampMs, points, chart),
                chartY(last.mmolL, chart, bounds.first, bounds.second),
                GlucoseSemantics.colorArgb(snapshot, GlucoseSemantics.freshness(snapshot)),
                5f,
            )
        }
        drawText(canvas, "-3h", chart.left, 137f, 10f, 0xFFCFD2D2.toInt(), Paint.Align.LEFT)
        drawText(canvas, "-2h", chart.left + chart.width() / 3f, 137f, 10f, 0xFFCFD2D2.toInt())
        drawText(canvas, "-1h", chart.left + chart.width() * 2f / 3f, 137f, 10f, 0xFFCFD2D2.toInt())
        drawText(canvas, "NOW", chart.right, 137f, 10f, cyan, Paint.Align.RIGHT, true)
        return bitmap
    }

    private fun renderOrbit(
        snapshot: GlucoseSnapshot?,
        history: List<GlucoseHistoryPoint>,
    ): Bitmap {
        val bitmap = Bitmap.createBitmap(450, 450, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        val points = pointsForWindow(history, 3)
        val bounds = chartBounds(points)
        val centerX = 225f
        val centerY = 225f
        val startAngleDegrees = 147f
        val sweepDegrees = 213f
        val startAngle = Math.toRadians(startAngleDegrees.toDouble())
        val sweep = Math.toRadians(sweepDegrees.toDouble())
        // The labelled dotted orbit is the outside scale. The live glucose
        // trace always remains inside it, and only the gap is softly filled.
        val referenceRadius = 195f
        val trace = Path()
        val fill = Path()

        paint.style = Paint.Style.STROKE
        paint.strokeWidth = 1.5f
        paint.pathEffect = DashPathEffect(floatArrayOf(2f, 5f), 0f)
        paint.color = 0xFF58757B.toInt()
        canvas.drawArc(
            RectF(
                centerX - referenceRadius,
                centerY - referenceRadius,
                centerX + referenceRadius,
                centerY + referenceRadius,
            ),
            startAngleDegrees,
            sweepDegrees,
            false,
            paint,
        )
        paint.pathEffect = null

        if (points.size > 1) {
            val tracePoints =
                points.mapIndexed { index, point ->
                    val fraction = index.toFloat() / (points.size - 1).toFloat()
                    val angle = startAngle + sweep * fraction
                    val radius =
                        orbitTraceRadius(
                            fraction,
                            point.mmolL,
                            referenceRadius,
                            bounds,
                        )
                    Pair(
                        centerX + cos(angle).toFloat() * radius,
                        centerY + sin(angle).toFloat() * radius,
                    )
                }
            appendSmoothPath(trace, tracePoints)

            val firstAngle = startAngle
            fill.moveTo(
                centerX + cos(firstAngle).toFloat() * referenceRadius,
                centerY + sin(firstAngle).toFloat() * referenceRadius,
            )
            fill.lineTo(tracePoints.first().first, tracePoints.first().second)
            appendSmoothPath(fill, tracePoints, moveToFirst = false)

            points.indices.reversed().forEach { index ->
                val fraction = index.toFloat() / (points.size - 1).toFloat()
                val angle = startAngle + sweep * fraction
                fill.lineTo(
                    centerX + cos(angle).toFloat() * referenceRadius,
                    centerY + sin(angle).toFloat() * referenceRadius,
                )
            }
            fill.close()
            paint.style = Paint.Style.FILL
            paint.color = 0x2A167985
            canvas.drawPath(fill, paint)
            paint.style = Paint.Style.STROKE
            paint.strokeWidth = 2.5f
            paint.strokeCap = Paint.Cap.ROUND
            paint.strokeJoin = Paint.Join.ROUND
            tracePoints.zipWithNext().forEachIndexed { index, pair ->
                paint.color = GlucoseSemantics.colorArgb(points[index + 1].colorToken)
                canvas.drawLine(
                    pair.first.first,
                    pair.first.second,
                    pair.second.first,
                    pair.second.second,
                    paint,
                )
            }

            val last = points.last()
            val radius = orbitTraceRadius(1f, last.mmolL, referenceRadius, bounds)
            val endX = centerX + cos(startAngle + sweep).toFloat() * radius
            val endY = centerY + sin(startAngle + sweep).toFloat() * radius
            drawEndpoint(
                canvas,
                endX,
                endY,
                GlucoseSemantics.colorArgb(snapshot, GlucoseSemantics.freshness(snapshot)),
                8f,
            )
        }

        val orbitTicks = chartTicks(bounds, 4)
        drawScaleLabel(canvas, formatScale(orbitTicks[3]), 88f, 92f)
        drawScaleLabel(canvas, formatScale(orbitTicks[2]), 43f, 181f)
        drawScaleLabel(canvas, formatScale(orbitTicks[1]), 44f, 286f)
        drawScaleLabel(canvas, formatScale(orbitTicks[0]), 95f, 379f)
        return bitmap
    }

    private fun orbitTraceRadius(
        fraction: Float,
        glucose: Double,
        referenceRadius: Float,
        bounds: Pair<Double, Double>,
    ): Float {
        val span = max(1.0, bounds.second - bounds.first)
        val radius =
            149f +
                ((glucose.coerceIn(bounds.first, bounds.second) - bounds.first) /
                    span * 29.0).toFloat()
        val labelClearanceInset =
            when {
                fraction <= 0.42f -> 18f
                fraction < 0.58f -> 18f * (0.58f - fraction) / 0.16f
                else -> 0f
            }
        return (radius - labelClearanceInset).coerceAtMost(referenceRadius - 3f)
    }

    private fun drawScaleLabel(
        canvas: Canvas,
        text: String,
        x: Float,
        baseline: Float,
    ) {
        val size = 15f
        val paint =
            Paint(Paint.ANTI_ALIAS_FLAG).apply {
                style = Paint.Style.FILL
                textAlign = Paint.Align.LEFT
                textSize = size
                typeface = Typeface.create(Typeface.DEFAULT, Typeface.NORMAL)
            }
        paint.color = 0xFFD0D8DA.toInt()
        canvas.drawText(text, x, baseline, paint)
    }

    private fun appendSmoothPath(
        path: Path,
        points: List<Pair<Float, Float>>,
        moveToFirst: Boolean = true,
    ) {
        if (points.isEmpty()) return
        if (moveToFirst) path.moveTo(points.first().first, points.first().second)
        for (index in 0 until points.lastIndex) {
            val previous = points[max(0, index - 1)]
            val current = points[index]
            val next = points[index + 1]
            val following = points[minOf(points.lastIndex, index + 2)]
            path.cubicTo(
                current.first + (next.first - previous.first) / 6f,
                current.second + (next.second - previous.second) / 6f,
                next.first - (following.first - current.first) / 6f,
                next.second - (following.second - current.second) / 6f,
                next.first,
                next.second,
            )
        }
    }

    private fun pointsForWindow(
        history: List<GlucoseHistoryPoint>,
        hours: Int,
    ): List<GlucoseHistoryPoint> {
        val sorted = history.sortedBy(GlucoseHistoryPoint::timestampMs)
        val end = sorted.lastOrNull()?.timestampMs ?: return emptyList()
        val start = end - hours * 60 * 60_000L
        return sorted.filter { it.timestampMs in start..end }
    }

    private fun historyPath(
        points: List<GlucoseHistoryPoint>,
        chart: RectF,
        minimum: Double,
        maximum: Double,
    ): Path? {
        if (points.size < 2) return null
        return Path().apply {
            points.forEachIndexed { index, point ->
                val x = chartX(point.timestampMs, points, chart)
                val y = chartY(point.mmolL, chart, minimum, maximum)
                val gap =
                    index == 0 ||
                        point.timestampMs - points[index - 1].timestampMs > 12 * 60_000L
                if (gap) moveTo(x, y) else lineTo(x, y)
            }
        }
    }

    private fun chartBounds(
        points: List<GlucoseHistoryPoint>,
    ): Pair<Double, Double> {
        val measuredMinimum = points.minOfOrNull(GlucoseHistoryPoint::mmolL) ?: 3.9
        val measuredMaximum = points.maxOfOrNull(GlucoseHistoryPoint::mmolL) ?: 10.0
        val rawMinimum = minOf(3.9, measuredMinimum)
        val rawMaximum = maxOf(10.0, measuredMaximum)
        val padding = max(0.6, (rawMaximum - rawMinimum) * 0.08)
        val minimum = max(0.0, kotlin.math.floor((rawMinimum - padding) * 2.0) / 2.0)
        val maximum = kotlin.math.ceil((rawMaximum + padding) * 2.0) / 2.0
        return minimum to max(minimum + 1.0, maximum)
    }

    private fun chartTicks(
        bounds: Pair<Double, Double>,
        count: Int,
    ): List<Double> =
        List(count) { index ->
            bounds.first +
                (bounds.second - bounds.first) * index / max(1, count - 1)
        }

    private fun formatScale(value: Double): String =
        if (kotlin.math.abs(value - kotlin.math.round(value)) < 0.05) {
            kotlin.math.round(value).toInt().toString()
        } else {
            String.format(Locale.UK, "%.1f", value)
        }

    private fun drawColouredLinearTrace(
        canvas: Canvas,
        points: List<GlucoseHistoryPoint>,
        chart: RectF,
        bounds: Pair<Double, Double>,
        paint: Paint,
    ) {
        points.zipWithNext().forEach { (start, end) ->
            if (end.timestampMs - start.timestampMs > 12 * 60_000L) return@forEach
            val startX = chartX(start.timestampMs, points, chart)
            val endX = chartX(end.timestampMs, points, chart)
            val startY = chartY(start.mmolL, chart, bounds.first, bounds.second)
            val endY = chartY(end.mmolL, chart, bounds.first, bounds.second)
            val middleX = (startX + endX) / 2f
            val middleY = (startY + endY) / 2f
            paint.color = GlucoseSemantics.colorArgb(start.colorToken)
            canvas.drawLine(startX, startY, middleX, middleY, paint)
            paint.color = GlucoseSemantics.colorArgb(end.colorToken)
            canvas.drawLine(middleX, middleY, endX, endY, paint)
        }
    }

    private fun chartX(
        timestampMs: Long,
        points: List<GlucoseHistoryPoint>,
        chart: RectF = RectF(28f, 7f, 394f, 72f),
    ): Float {
        val start = points.first().timestampMs
        val end = points.last().timestampMs
        return chart.left +
            (timestampMs - start).toFloat() / max(1L, end - start).toFloat() * chart.width()
    }

    private fun chartY(
        mmolL: Double,
        chart: RectF,
        minimum: Double,
        maximum: Double,
    ): Float =
        chart.bottom -
            ((mmolL.coerceIn(minimum, maximum) - minimum) / (maximum - minimum)).toFloat() *
                chart.height()

    private fun drawEndpoint(
        canvas: Canvas,
        x: Float,
        y: Float,
        color: Int,
        radius: Float,
    ) {
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        paint.style = Paint.Style.FILL
        paint.color = Color.BLACK
        canvas.drawCircle(x, y, radius + 3f, paint)
        paint.color = color
        canvas.drawCircle(x, y, radius, paint)
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = 2f
        paint.color = 0xFFE7EDF0.toInt()
        canvas.drawCircle(x, y, radius + 1f, paint)
    }

    private fun drawText(
        canvas: Canvas,
        text: String,
        x: Float,
        baseline: Float,
        size: Float,
        color: Int,
        align: Paint.Align = Paint.Align.CENTER,
        bold: Boolean = false,
    ) {
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        paint.style = Paint.Style.FILL
        paint.textAlign = align
        paint.textSize = size
        paint.color = color
        paint.typeface =
            Typeface.create(Typeface.DEFAULT, if (bold) Typeface.BOLD else Typeface.NORMAL)
        canvas.drawText(text, x, baseline, paint)
    }

    protected enum class GraphStyle {
        MERIDIAN,
        CHRONOGRAPH,
        ORBIT,
    }
}

class T1ArcChronographGraphComplicationService : T1ArcGraphComplicationService() {
    override val graphStyle = GraphStyle.CHRONOGRAPH
}

class T1ArcOrbitGraphComplicationService : T1ArcGraphComplicationService() {
    override val graphStyle = GraphStyle.ORBIT
}
