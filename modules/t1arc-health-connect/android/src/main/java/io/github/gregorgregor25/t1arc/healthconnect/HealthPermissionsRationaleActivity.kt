package io.github.gregorgregor25.t1arc.healthconnect

import android.app.Activity
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

/**
 * Health Connect can launch this screen when the user asks why access is
 * needed. It deliberately contains no health data and works without React.
 */
class HealthPermissionsRationaleActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)

    val padding = (24 * resources.displayMetrics.density).toInt()
    val content =
      LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        gravity = Gravity.START
        setPadding(padding, padding, padding, padding)

        addView(
          TextView(context).apply {
            text = "Your health data stays yours"
            textSize = 26f
            setTextColor(resolveTextColor())
          },
          LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
          ),
        )

        addView(
          TextView(context).apply {
            text =
              "This app reads only the Health Connect categories you approve, " +
                "such as steps, workouts, sleep, heart rate and weight. Records " +
                "are copied into this device's encrypted local database so they " +
                "can be shown beside glucose and insulin. They are not uploaded " +
                "to a T1 Arc-operated server, sold, or used to recommend insulin doses."
            textSize = 17f
            setLineSpacing(0f, 1.25f)
            setTextColor(resolveTextColor())
            setPadding(0, padding, 0, padding)
          },
          LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
          ),
        )

        addView(
          Button(context).apply {
            text = "Close"
            setOnClickListener { finish() }
          },
          LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            (52 * resources.displayMetrics.density).toInt(),
          ),
        )
      }

    setContentView(
      ScrollView(this).apply { addView(content) },
      ViewGroup.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.MATCH_PARENT,
      ),
    )
  }

  private fun resolveTextColor(): Int {
    val attributes = obtainStyledAttributes(intArrayOf(android.R.attr.textColorPrimary))
    return try {
      attributes.getColor(0, Color.BLACK)
    } finally {
      attributes.recycle()
    }
  }
}
