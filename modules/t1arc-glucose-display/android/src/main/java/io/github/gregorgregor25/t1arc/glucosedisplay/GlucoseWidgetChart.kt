package io.github.gregorgregor25.t1arc.glucosedisplay

import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Shader

internal object GlucoseWidgetChart {
  // A fixed, bounded bitmap keeps RemoteViews safely below Binder limits.
  fun draw(canvas: Canvas, width: Float, height: Float, trace: WidgetTrace, fillColor: Int, stale: Boolean, colorFor: (Double) -> Int) {
    val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    trace.runs.forEach { run ->
      if (run.size == 1) {
        paint.style = Paint.Style.FILL
        paint.color = colorFor(run.first().value)
        canvas.drawCircle(run.first().x * width, run.first().y * height, 1.5f, paint)
      } else {
        val line = Path().apply { moveTo(run.first().x * width, run.first().y * height) }
        val segments = run.zipWithNext().map { (a, b) ->
          val mid = (a.x + b.x) / 2 * width
          line.cubicTo(mid, a.y * height, mid, b.y * height, b.x * width, b.y * height)
          Path().apply {
            moveTo(a.x * width, a.y * height)
            cubicTo(mid, a.y * height, mid, b.y * height, b.x * width, b.y * height)
          } to b.value
        }
        val area = Path(line).apply {
          lineTo(run.last().x * width, height)
          lineTo(run.first().x * width, height)
          close()
        }
        val color = fillColor
        paint.style = Paint.Style.FILL
        paint.shader = LinearGradient(0f, 0f, 0f, height,
          intArrayOf((color and 0x00FFFFFF) or 0x4D000000, (color and 0x00FFFFFF) or 0x16000000, color and 0x00FFFFFF), floatArrayOf(0f, 0.72f, 1f), Shader.TileMode.CLAMP)
        canvas.drawPath(area, paint)
        paint.shader = null
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = 1.25f
        paint.strokeCap = Paint.Cap.ROUND
        paint.strokeJoin = Paint.Join.ROUND
        segments.forEach { (path, value) ->
          paint.color = colorFor(value)
          paint.alpha = if (stale) 95 else 169
          canvas.drawPath(path, paint)
        }
      }
    }
  }
}
