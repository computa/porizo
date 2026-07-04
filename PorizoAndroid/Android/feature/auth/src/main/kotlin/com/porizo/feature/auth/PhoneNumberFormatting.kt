package com.porizo.feature.auth

data class PhoneCountry(
    val id: String,
    val dialCode: String,
    val placeholder: String,
)

object PhoneNumberFormatting {
    val defaultCountry = PhoneCountry(
        id = "US",
        dialCode = "+1",
        placeholder = "(555) 123-4567",
    )

    fun normalizedE164PhoneNumber(
        rawInput: String,
        selectedCountry: PhoneCountry = defaultCountry,
    ): String? {
        val raw = rawInput.trim()
        if (raw.isEmpty()) return null

        val digits = raw.filter(Char::isDigit)
        if (hasExplicitInternationalPrefix(raw)) {
            val internationalDigits = digitsDroppingInternationalPrefix(digits, raw)
            val dialDigits = selectedCountry.dialCode.filter(Char::isDigit)
            if (internationalDigits.startsWith(dialDigits)) {
                val national = internationalDigits.drop(dialDigits.length)
                return national.takeIf { it.isNotEmpty() }?.let { selectedCountry.dialCode + it }
            }
            return internationalDigits
                .takeIf { it.length in 8..15 }
                ?.let { "+$it" }
        }

        if (digits.isEmpty()) return null
        val normalizedNational = if (selectedCountry.dialCode == "+1") {
            when {
                digits.length == 10 -> digits
                digits.length == 11 && digits.first() == '1' -> digits.drop(1)
                else -> return null
            }
        } else {
            digits
                .removePrefix("0")
                .takeIf { it.length in 6..15 }
                ?: return null
        }

        return selectedCountry.dialCode + normalizedNational
    }

    fun isValidPhoneNumberInput(
        rawInput: String,
        selectedCountry: PhoneCountry = defaultCountry,
    ): Boolean =
        normalizedE164PhoneNumber(rawInput, selectedCountry) != null

    private fun hasExplicitInternationalPrefix(input: String): Boolean {
        val trimmed = input.trim()
        return trimmed.startsWith("+") || trimmed.startsWith("00") || trimmed.startsWith("011")
    }

    private fun digitsDroppingInternationalPrefix(digits: String, rawInput: String): String {
        val trimmed = rawInput.trim()
        return when {
            trimmed.startsWith("+") -> digits
            trimmed.startsWith("011") && digits.startsWith("011") -> digits.drop(3)
            trimmed.startsWith("00") && digits.startsWith("00") -> digits.drop(2)
            else -> digits
        }
    }
}
