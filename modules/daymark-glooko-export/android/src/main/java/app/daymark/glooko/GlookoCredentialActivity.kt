package app.daymark.glooko

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

internal fun glookoCredentialConfirmationCopy(
  legacyCredentialContinuity: Boolean,
) =
  if (legacyCredentialContinuity) {
    "I confirm this saved Glooko sign-in belongs to the same person as " +
      "the existing Glooko data in T1 Arc, and it uses UK local time " +
      "with dates written day/month/year."
  } else {
    "I confirm this account uses UK local time with dates written " +
      "day/month/year."
  }

class GlookoCredentialActivity : Activity() {
  companion object {
    const val RESULT_STATUS = "status"
    const val RESULT_MASKED_EMAIL = "maskedEmail"
    const val RESULT_CREDENTIAL_GENERATION = "credentialGeneration"
    const val RESULT_LEGACY_CREDENTIAL_CONTINUITY =
      "legacyCredentialContinuity"
    const val EXTRA_LEGACY_CREDENTIAL_CONTINUITY_REQUIRED =
      "legacyCredentialContinuityRequired"
  }

  private val vault by lazy { GlookoCredentialVault(this) }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
    title = "Automatic Glooko sign-in"

    val density = resources.displayMetrics.density
    fun dp(value: Int) = (value * density).toInt()

    val backgroundColor =
      resolveColor(android.R.attr.colorBackground, Color.rgb(6, 25, 27))
    val surface = resolveColor(android.R.attr.colorBackgroundFloating, Color.rgb(15, 43, 47))
    val primaryTextColor =
      resolveColor(android.R.attr.textColorPrimary, Color.WHITE)
    val secondary = resolveColor(android.R.attr.textColorSecondary, Color.LTGRAY)
    val accent = Color.rgb(91, 202, 223)
    val hasStoredCredentials = vault.hasStoredCredentials()
    val needsFormatConfirmation =
      hasStoredCredentials && !vault.isUkFormatConfirmed()
    val legacyCredentialContinuityRequired =
      needsFormatConfirmation ||
        intent.getBooleanExtra(
          EXTRA_LEGACY_CREDENTIAL_CONTINUITY_REQUIRED,
          false,
        )

    val content =
      LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(22), dp(30), dp(22), dp(30))
        setBackgroundColor(backgroundColor)
      }

    content.addView(
      TextView(this).apply {
        this.text = "Automatic Glooko sign-in"
        textSize = 28f
        setTextColor(primaryTextColor)
        setTypeface(typeface, Typeface.BOLD)
      },
    )
    content.addView(
      TextView(this).apply {
        this.text =
          if (legacyCredentialContinuityRequired) {
            if (hasStoredCredentials) {
              "A Glooko sign-in is already saved securely on this phone. "
            } else {
              "Enter the Glooko sign-in you want to reconnect on this phone. "
            } +
              "Confirm that it belongs to the same person " +
              "as the existing Glooko data and uses UK dates and times." +
              if (needsFormatConfirmation) {
                " You do not need to enter the password again."
              } else {
                ""
              }
          } else {
            "T1 Arc can use your Glooko sign-in to keep your glucose and " +
              "insulin history up to date automatically."
          }
        textSize = 16f
        setTextColor(secondary)
        setLineSpacing(0f, 1.18f)
        setPadding(0, dp(10), 0, dp(22))
      },
    )

    val privacyCard =
      LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(18), dp(16), dp(18), dp(16))
        this.background =
          GradientDrawable().apply {
            setColor(surface)
            setStroke(dp(1), Color.argb(90, 91, 202, 223))
            cornerRadius = dp(18).toFloat()
          }
      }
    privacyCard.addView(
      TextView(this).apply {
        this.text = "Private by design"
        textSize = 17f
        setTextColor(primaryTextColor)
        setTypeface(typeface, Typeface.BOLD)
      },
    )
    privacyCard.addView(
      TextView(this).apply {
        this.text =
          "Your sign-in stays securely on this phone and is sent only to " +
            "Glooko when T1 Arc checks for updates. It is never included in " +
            "backups or sent to T1 Arc, GitHub or another service."
        textSize = 14f
        setTextColor(secondary)
        setLineSpacing(0f, 1.15f)
        setPadding(0, dp(6), 0, 0)
      },
    )
    content.addView(
      privacyCard,
      LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.WRAP_CONTENT,
      ).apply {
        bottomMargin = dp(24)
      },
    )

    val emailInput =
      EditText(this).apply {
        hint = "Glooko email"
        inputType =
          InputType.TYPE_CLASS_TEXT or
            InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS
        setSingleLine(true)
        setTextColor(primaryTextColor)
        setHintTextColor(secondary)
        importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_YES
        setAutofillHints("emailAddress", "username")
      }
    val passwordInput =
      EditText(this).apply {
        hint = "Glooko password"
        inputType =
          InputType.TYPE_CLASS_TEXT or
            InputType.TYPE_TEXT_VARIATION_PASSWORD
        setSingleLine(true)
        setTextColor(primaryTextColor)
        setHintTextColor(secondary)
        importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_YES
        setAutofillHints("password")
      }
    if (!needsFormatConfirmation) {
      content.addView(
        emailInput,
        LinearLayout.LayoutParams(
          ViewGroup.LayoutParams.MATCH_PARENT,
          dp(58),
        ).apply {
          bottomMargin = dp(12)
        },
      )
      content.addView(
        passwordInput,
        LinearLayout.LayoutParams(
          ViewGroup.LayoutParams.MATCH_PARENT,
          dp(58),
        ).apply {
          bottomMargin = dp(12)
        },
      )
    }
    content.addView(
      TextView(this).apply {
        text = "Available for UK accounts on Glooko EU"
        textSize = 14f
        setTextColor(secondary)
        setPadding(0, dp(4), 0, dp(12))
      },
    )

    val formatConfirmation =
      CheckBox(this).apply {
        text =
          glookoCredentialConfirmationCopy(
            legacyCredentialContinuityRequired,
          )
        textSize = 14f
        setTextColor(primaryTextColor)
        buttonTintList =
          android.content.res.ColorStateList.valueOf(accent)
        setPadding(0, dp(4), 0, dp(12))
      }
    content.addView(formatConfirmation)
    content.addView(
      TextView(this).apply {
        text =
          "T1 Arc cannot safely use dates from other regions yet. If this " +
            "account does not use UK local time and day/month/year dates, cancel."
        textSize = 13f
        setTextColor(secondary)
        setLineSpacing(0f, 1.15f)
        setPadding(dp(4), 0, dp(4), dp(12))
      },
    )

    val errorText =
      TextView(this).apply {
        textSize = 13f
        setTextColor(Color.rgb(255, 139, 170))
        visibility = View.GONE
        setPadding(0, 0, 0, dp(10))
      }
    content.addView(errorText)

    val saveButton =
      Button(this).apply {
        this.text =
          if (needsFormatConfirmation) {
            "Confirm account and UK format"
          } else {
            "Save sign-in"
          }
        isAllCaps = false
        textSize = 15f
        setTextColor(Color.rgb(4, 28, 31))
        backgroundTintList = android.content.res.ColorStateList.valueOf(accent)
        isEnabled = false
        alpha = 0.55f
        setOnClickListener {
          runCatching {
            require(formatConfirmation.isChecked) {
              "Confirm the UK export format before continuing."
            }
            if (needsFormatConfirmation) {
              vault.confirmUkFormat()
            } else {
              vault.save(
                emailInput.text?.toString().orEmpty(),
                passwordInput.text?.toString().orEmpty(),
                GlookoRegion.EU,
                ukFormatConfirmed = true,
              )
            }
          }.onSuccess {
            passwordInput.text?.clear()
            setResult(
              RESULT_OK,
              Intent().apply {
                putExtra(RESULT_STATUS, "saved")
                vault.maskedEmail()?.let {
                  putExtra(RESULT_MASKED_EMAIL, it)
                }
                putExtra(
                  RESULT_CREDENTIAL_GENERATION,
                  vault.credentialGeneration(),
                )
                putExtra(
                  RESULT_LEGACY_CREDENTIAL_CONTINUITY,
                  legacyCredentialContinuityRequired,
                )
              },
            )
            finish()
          }.onFailure { error ->
            errorText.text =
              error.message ?: "The sign-in could not be saved."
            errorText.visibility = View.VISIBLE
          }
        }
      }
    formatConfirmation.setOnCheckedChangeListener { _, checked ->
      saveButton.isEnabled = checked
      saveButton.alpha = if (checked) 1f else 0.55f
      if (checked) errorText.visibility = View.GONE
    }
    content.addView(
      saveButton,
      LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        dp(58),
      ).apply {
        topMargin = dp(4)
      },
    )
    content.addView(
      Button(this).apply {
        this.text = "Cancel"
        isAllCaps = false
        textSize = 15f
        setTextColor(secondary)
        backgroundTintList =
          android.content.res.ColorStateList.valueOf(Color.TRANSPARENT)
        setOnClickListener {
          setResult(
            RESULT_CANCELED,
            Intent().putExtra(RESULT_STATUS, "cancelled"),
          )
          finish()
        }
      },
      LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        dp(54),
      ).apply {
        topMargin = dp(8)
      },
    )
    content.addView(
      TextView(this).apply {
        this.text =
          "You can remove the saved sign-in at any time from Sources. " +
            "Doing so never removes imported glucose or insulin."
        textSize = 13f
        gravity = Gravity.CENTER
        setTextColor(secondary)
        setPadding(dp(8), dp(14), dp(8), 0)
      },
    )

    setContentView(
      ScrollView(this).apply {
        isFillViewport = true
        setBackgroundColor(backgroundColor)
        addView(
          content,
          ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
          ),
        )
      },
    )
  }

  private fun resolveColor(attribute: Int, fallback: Int): Int {
    val typed = android.util.TypedValue()
    return if (theme.resolveAttribute(attribute, typed, true)) {
      if (typed.resourceId != 0) getColor(typed.resourceId) else typed.data
    } else {
      fallback
    }
  }
}
